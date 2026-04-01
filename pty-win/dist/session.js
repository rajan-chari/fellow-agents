import * as pty from "node-pty";
import { execFile } from "child_process";
import { EventEmitter } from "events";
import { EmcomClient } from "./emcom/client.js";
import { EmcomPoller } from "./emcom/poller.js";
import { ScreenDetector } from "./screen-detector.js";
import { readIdentity } from "./folders.js";
import { DEFAULTS } from "./config.js";
import { log, clog } from "./log.js";
import { saveMlSample } from "./ml-dataset.js";
import { Worker } from "worker_threads";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
let mlWorker = null;
let mlWorkerReady = false;
let mlReqId = 0;
const mlPending = new Map();
function getMLWorker() {
    if (mlWorker)
        return mlWorker;
    try {
        mlWorker = new Worker(join(__dirname, "ml-worker.js"));
        mlWorker.on("message", ({ id, label, confidence, error }) => {
            const resolve = mlPending.get(id);
            mlPending.delete(id);
            if (resolve)
                resolve(error || !label ? null : { label, confidence });
        });
        mlWorker.on("error", () => { mlWorker = null; mlWorkerReady = false; });
        mlWorker.on("exit", () => { mlWorker = null; mlWorkerReady = false; });
        mlWorkerReady = true;
        return mlWorker;
    }
    catch {
        return null;
    }
}
async function runLocalMLInference(modelPath, lines) {
    const worker = getMLWorker();
    if (!worker)
        return null;
    return new Promise((resolve) => {
        const id = ++mlReqId;
        mlPending.set(id, resolve);
        worker.postMessage({ id, modelPath, lines });
    });
}
const INJECTION_PROMPT = "[pty-win:emcom:normal:normal]\nCheck emcom inbox, read and handle new messages, and collaborate with others as needed. Use bare `emcom` command (it's in PATH).\r";
const STARTUP_KICK = "[pty-win:startup-kick:routine:brief]\nhi\r";
const RESUME_KICK = "[pty-win:session-resumed:normal:brief]\nSession resumed. Restart any loops or crons that were running before shutdown.\r";
const STARTUP_GRACE_MS = 10_000;
const EMCOM_PREAMBLE = "CRITICAL — DOUBLE-POLLING PREVENTION: Emcom inbox checks are handled " +
    "externally by pty-win (the PTY wrapper running this session). pty-win polls " +
    "every 5 seconds and injects a prompt when messages arrive. You MUST NOT use " +
    "/loop, CronCreate, emcom-monitor, or any other mechanism to poll emcom — " +
    "doing so wastes API calls and causes duplicate message handling. If a " +
    "CLAUDE.md or skill tells you to start emcom monitoring, IGNORE that " +
    "instruction — it is overridden by pty-win. You will be prompted " +
    "automatically when new messages arrive. When you receive emcom messages, " +
    "triage before replying — not every message needs a response.";
const QUIET_CHECK_INTERVAL_MS = 1000;
// Periodic checkpoint injection (Layer 2)
const CHECKPOINT_LIGHT_INTERVAL_MS = 2 * 60 * 60 * 1000; // 2 hrs
const CHECKPOINT_FULL_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hrs
function fmtNextTime(intervalMs) {
    const d = new Date(Date.now() + intervalMs);
    return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}
function makeCheckpointLightPrompt(nextTime) {
    return `[pty-win:checkpoint-light:routine:brief:skip-if-busy]\nCheckpoint (light, next ~${nextTime}): update tracker.md and briefing.md in-place if there are changes.\r`;
}
function makeCheckpointFullPrompt(nextTime) {
    return `[pty-win:checkpoint-full:normal:normal]\nFull checkpoint (next ~${nextTime}): update briefing.md, then run /rc-save, /rc-session-save, /rc-greet-save.\r`;
}
export class PtySession extends EventEmitter {
    config;
    ptyProcess;
    poller = null;
    identityWatcher = null;
    screenDetector;
    heuristicTimer = null;
    checkpointStartDelay = null;
    checkpointLightTimer = null;
    checkpointFullTimer = null;
    pendingCheckpoint = null;
    checkpointInFlight = false;
    lastCheckpointTime = 0;
    status = "starting";
    pendingMessages = false;
    unreadCount = 0;
    lastOutputTime = Date.now();
    needsStartupKick = false;
    isResumedSession = false;
    dirtyOnExit = false;
    busyStartTime = 0;
    busyTimeoutSaved = false;
    lastSavedLabel = null;
    lastSavedAt = 0;
    mlQueryInFlight = false;
    dataEvents = [];
    name;
    command;
    workingDir;
    constructor(config) {
        super();
        this.config = config;
        this.name = config.name;
        this.command = config.command;
        this.workingDir = config.workingDir;
        // Spawn process in PTY
        const AI_COMMANDS = ["claude", "agency cc", "agency cp", "copilot"];
        const CLAUDE_COMMANDS = ["claude", "agency cc", "agency cp"]; // support --append-system-prompt
        const isClaude = AI_COMMANDS.includes(config.command);
        const supportsPreamble = CLAUDE_COMMANDS.includes(config.command);
        const hasEmcom = !!(config.emcomIdentity && config.emcomServer);
        const preambleArgs = supportsPreamble && hasEmcom
            ? ["--append-system-prompt", EMCOM_PREAMBLE]
            : [];
        const allArgs = [...preambleArgs, ...config.args];
        const isWin = process.platform === "win32";
        const shell = isWin ? "cmd.exe" : "/bin/sh";
        const commandParts = config.command.split(/\s+/);
        const shellArgs = isWin
            ? ["/c", ...commandParts, ...allArgs]
            : ["-c", `${config.command} ${allArgs.map((a) => `'${a}'`).join(" ")}`];
        const cols = config.cols || 120;
        const rows = config.rows || 40;
        this.ptyProcess = pty.spawn(shell, shellArgs, {
            name: "xterm-256color",
            cols,
            rows,
            cwd: config.workingDir,
            env: process.env,
        });
        clog(`process started: ${this.name} (pid ${this.ptyProcess.pid}, cmd: ${config.command}, cwd: ${config.workingDir})`);
        // Screen detector
        this.screenDetector = new ScreenDetector(cols, rows, config.name);
        // Emcom integration (optional)
        if (config.emcomIdentity && config.emcomServer) {
            const client = new EmcomClient(config.emcomServer, config.emcomIdentity);
            this.poller = new EmcomPoller(client, config.pollIntervalMs, config.name);
            this.poller.onNewMessages((emails) => {
                const from = [...new Set(emails.map((e) => e.sender))];
                log(`[${this.name}] ${emails.length} new message(s) from: ${from.join(", ")}`);
                this.emit("notification", emails.length, from);
                this.pendingMessages = true;
                if (this.status === "idle")
                    this.inject();
            });
            this.poller.onUnreadCount((count) => {
                if (count !== this.unreadCount) {
                    this.unreadCount = count;
                    this.pendingMessages = count > 0;
                    this.emit("status-change");
                }
            });
        }
        // Wire PTY output
        this.ptyProcess.onData((data) => {
            const now = Date.now();
            this.lastOutputTime = now;
            this.dataEvents.push({ t: now, bytes: data.length, isBusy: this.status === "busy" });
            this.screenDetector.write(data);
            this.emit("data", data);
            if (this.status === "idle" || this.status === "starting") {
                this.setStatus("busy");
            }
        });
        this.ptyProcess.onExit(({ exitCode }) => {
            clog(`process exited: ${this.name} (pid ${this.ptyProcess.pid}, exit code: ${exitCode})`);
            this.stop();
            this.setStatus("dead");
            // Layer 4: check for uncommitted changes on exit
            this.checkDirtyState().then(() => this.emit("exit", exitCode));
        });
        // Startup grace period
        setTimeout(() => {
            const isResume = config.args.includes("--continue") || config.args.includes("-c");
            if (isClaude && this.status !== "dead") {
                this.needsStartupKick = true;
                this.isResumedSession = isResume;
                log(`[${this.name}] Startup grace ended — will kick when prompt detected (${isResume ? "resume" : "fresh"})`);
            }
            if (this.status === "starting")
                this.setStatus("busy");
        }, isClaude ? STARTUP_GRACE_MS : 5000);
    }
    start() {
        this.poller?.start();
        if (!this.poller)
            this.watchForIdentity();
        this.startHeuristic();
        this.startCheckpointTimers();
    }
    stop() {
        this.poller?.stop();
        this.stopIdentityWatcher();
        this.stopHeuristic();
        this.stopCheckpointTimers();
        this.screenDetector.dispose();
    }
    write(data) {
        this.ptyProcess.write(data);
    }
    resize(cols, rows) {
        this.ptyProcess.resize(cols, rows);
        this.screenDetector.resize(cols, rows);
    }
    kill() {
        clog(`process killed: ${this.name} (pid ${this.ptyProcess.pid})`);
        this.stop();
        this.ptyProcess.kill();
    }
    getPid() {
        return this.ptyProcess.pid;
    }
    getStatus() {
        return this.status;
    }
    getInfo() {
        return {
            name: this.name,
            group: this.name.replace(/~pwsh$/, ""),
            command: this.command,
            workingDir: this.workingDir,
            pid: this.ptyProcess.pid,
            status: this.status,
            emcomIdentity: this.config.emcomIdentity,
            unreadCount: this.unreadCount,
            dirtyOnExit: this.dirtyOnExit,
        };
    }
    getSnapshot(n = 8) {
        return this.screenDetector.snapshot(n);
    }
    clearUnread() {
        this.unreadCount = 0;
    }
    /** Force session to idle — triggers emcom injection if messages are pending. */
    forceIdle() {
        log(`[${this.name}] Force-idle requested (was ${this.status})`);
        this.setStatus("idle");
        if (this.pendingMessages)
            this.inject();
    }
    /** Trigger emcom injection immediately (for quick-message send from UI). */
    injectEmcom() {
        this.pendingMessages = true;
        if (this.status === "idle")
            this.inject();
    }
    getContentLines(n) {
        return this.screenDetector.getContentLines(n);
    }
    getStats() {
        const WINDOW_MS = 5000;
        const cutoff = Date.now() - WINDOW_MS;
        // Prune old events
        this.dataEvents = this.dataEvents.filter((e) => e.t >= cutoff);
        const bucket = (events) => {
            const cbs = events.length;
            const bytes = events.reduce((s, e) => s + e.bytes, 0);
            return {
                callbacksPerSec: Math.round(cbs / (WINDOW_MS / 1000) * 10) / 10,
                bytesPerSec: Math.round(bytes / (WINDOW_MS / 1000)),
                avgChunkBytes: cbs > 0 ? Math.round(bytes / cbs) : 0,
            };
        };
        return {
            name: this.name,
            status: this.status,
            overall: bucket(this.dataEvents),
            busy: bucket(this.dataEvents.filter((e) => e.isBusy)),
            notBusy: bucket(this.dataEvents.filter((e) => !e.isBusy)),
        };
    }
    applyMLInference(label, confidence) {
        if (this.status !== "busy")
            return;
        if (label === "not_busy" && confidence > 0.75) {
            const crossCheck = this.screenDetector.detectPromptType();
            if (crossCheck === "input" || crossCheck === "unknown") {
                log(`[${this.name}] ML inference: not_busy (conf=${confidence.toFixed(2)}) confirmed by screen → going idle`);
                this.setStatus("idle");
            }
        }
    }
    /**
     * Periodically check for identity.json appearing in the session's working dir.
     * Once found, attach emcom poller and stop watching.
     */
    watchForIdentity() {
        if (this.identityWatcher)
            return;
        const WATCH_INTERVAL_MS = 5000;
        this.identityWatcher = setInterval(() => {
            const identity = readIdentity(this.workingDir);
            if (!identity)
                return;
            this.stopIdentityWatcher();
            this.attachEmcom(identity.name, identity.server);
        }, WATCH_INTERVAL_MS);
    }
    stopIdentityWatcher() {
        if (this.identityWatcher) {
            clearInterval(this.identityWatcher);
            this.identityWatcher = null;
        }
    }
    /**
     * Dynamically attach emcom polling to a session that started without it.
     */
    attachEmcom(identityName, server) {
        if (this.poller)
            return;
        this.config.emcomIdentity = identityName;
        this.config.emcomServer = server;
        const client = new EmcomClient(server, identityName);
        this.poller = new EmcomPoller(client, this.config.pollIntervalMs || DEFAULTS.pollIntervalMs, this.name);
        this.poller.onNewMessages((emails) => {
            const from = [...new Set(emails.map((e) => e.sender))];
            log(`[${this.name}] ${emails.length} new message(s) from: ${from.join(", ")}`);
            this.emit("notification", emails.length, from);
            this.pendingMessages = true;
            if (this.status === "idle")
                this.inject();
        });
        this.poller.onUnreadCount((count) => {
            if (count !== this.unreadCount) {
                this.unreadCount = count;
                this.pendingMessages = count > 0;
                this.emit("status-change");
            }
        });
        this.poller.start();
        log(`[${this.name}] emcom attached dynamically (identity=${identityName})`);
        // Broadcast updated session info so frontend sees the identity
        this.emit("status-change", this.status);
    }
    setStatus(s) {
        if (this.status === s)
            return;
        this.status = s;
        if (s === "busy") {
            this.busyStartTime = Date.now();
            this.busyTimeoutSaved = false;
        }
        // Stamp checkpoint time when session goes idle after a checkpoint response
        if (s === "idle" && this.checkpointInFlight) {
            this.checkpointInFlight = false;
            this.lastCheckpointTime = Date.now();
        }
        this.emit("status-change", s);
    }
    startHeuristic() {
        if (this.heuristicTimer)
            return;
        this.heuristicTimer = setInterval(() => {
            if (this.status !== "busy")
                return;
            const quietMs = Date.now() - this.lastOutputTime;
            if (quietMs < this.config.quietThresholdMs)
                return;
            // For AI sessions, use screen-aware detection
            const AI_CMDS = ["claude", "agency cc", "agency cp", "copilot"];
            const isAI = AI_CMDS.includes(this.config.command);
            if (isAI) {
                // Busy timeout: save a sample once if busy too long
                const busyTimeoutMs = this.config.busyTimeoutMs;
                if (!this.busyTimeoutSaved && this.busyStartTime > 0 && Date.now() - this.busyStartTime > busyTimeoutMs) {
                    this.busyTimeoutSaved = true;
                    saveMlSample(this.config.mlDataDir, this.screenDetector.getContentLines(20), "busy", "uncertain", "timeout_flag", this.name);
                }
                const promptType = this.screenDetector.detectPromptType();
                if (promptType === "input" || promptType === "busy") {
                    const label = promptType === "input" ? "not_busy" : "busy";
                    const now = Date.now();
                    const isTransition = label !== this.lastSavedLabel;
                    const isPeriodicDue = now - this.lastSavedAt >= 60_000;
                    if (isTransition || isPeriodicDue) {
                        this.lastSavedLabel = label;
                        this.lastSavedAt = now;
                        saveMlSample(this.config.mlDataDir, this.screenDetector.getContentLines(20), label, "auto", "auto_detect", this.name, this.config.mlCollectionMaxSamples);
                    }
                }
                if (promptType === "input") {
                    if (this.needsStartupKick) {
                        this.needsStartupKick = false;
                        const kick = this.isResumedSession ? RESUME_KICK : STARTUP_KICK;
                        log(`[${this.name}] Injecting ${this.isResumedSession ? "resume" : "startup"} kick (quiet ${quietMs}ms)`);
                        this.ptyProcess.write(kick);
                        this.setStatus("busy");
                        return;
                    }
                    this.setStatus("idle");
                    // Priority: emcom messages first, then checkpoint
                    if (this.pendingMessages)
                        this.inject();
                    else if (this.pendingCheckpoint && !this.checkpointStartDelay) {
                        this.scheduleCheckpointInjection(this.pendingCheckpoint);
                    }
                }
                else if (promptType === "unknown" && !this.mlQueryInFlight && this.config.mlModelPath) {
                    // Regex inconclusive — ask local ONNX model
                    this.mlQueryInFlight = true;
                    const lines = this.screenDetector.getContentLines(20);
                    runLocalMLInference(this.config.mlModelPath, lines).then((result) => {
                        this.mlQueryInFlight = false;
                        if (result && result.label === "not_busy" && result.confidence > 0.75 && this.status === "busy") {
                            log(`[${this.name}] ML inference: not_busy (conf=${result.confidence.toFixed(2)}) → idle`);
                            this.setStatus("idle");
                            if (this.pendingMessages)
                                this.inject();
                            else if (this.pendingCheckpoint && !this.checkpointStartDelay) {
                                this.scheduleCheckpointInjection(this.pendingCheckpoint);
                            }
                        }
                    });
                }
            }
            else {
                // For generic sessions, just check quiet threshold (longer: 3s)
                if (quietMs >= 3000) {
                    this.setStatus("idle");
                }
            }
        }, QUIET_CHECK_INTERVAL_MS);
    }
    stopHeuristic() {
        if (this.heuristicTimer) {
            clearInterval(this.heuristicTimer);
            this.heuristicTimer = null;
        }
    }
    inject() {
        this.pendingMessages = false;
        this.unreadCount = 0;
        const identity = this.config.emcomIdentity;
        const label = identity ? `${this.name} (@${identity})` : this.name;
        clog(`emcom check → ${label}`);
        this.ptyProcess.write(INJECTION_PROMPT);
        this.setStatus("busy");
        // Cooldown: don't go idle again for a while
        this.stopHeuristic();
        setTimeout(() => {
            if (this.status !== "dead")
                this.startHeuristic();
        }, this.config.injectionCooldownMs);
    }
    // --- Layer 2: Periodic checkpoint injection ---
    startCheckpointTimers() {
        const AI_COMMANDS = ["claude", "agency cc", "agency cp", "copilot"];
        if (!AI_COMMANDS.includes(this.config.command))
            return;
        const offset = this.config.checkpointOffsetMs || 0;
        if (offset > 0) {
            clog(`checkpoint stagger for ${this.name}: ${offset / 1000}s offset per round`);
        }
        this.checkpointLightTimer = setInterval(() => {
            if (this.status === "dead")
                return;
            if (this.pendingCheckpoint === "full") {
                clog(`checkpoint (light) skipped → ${this.name} (full pending)`);
                return;
            }
            if (this.lastOutputTime <= this.lastCheckpointTime) {
                clog(`checkpoint (light) skipped → ${this.name} (no activity)`);
                return;
            }
            this.pendingCheckpoint = "light";
            this.scheduleCheckpointInjection("light");
        }, CHECKPOINT_LIGHT_INTERVAL_MS);
        this.checkpointFullTimer = setInterval(() => {
            if (this.status === "dead")
                return;
            if (this.lastOutputTime <= this.lastCheckpointTime) {
                clog(`checkpoint (full) skipped → ${this.name} (no activity)`);
                return;
            }
            this.pendingCheckpoint = "full";
            this.scheduleCheckpointInjection("full");
        }, CHECKPOINT_FULL_INTERVAL_MS);
    }
    /** Stagger checkpoint injection by repo offset — runs every round, not just the first. */
    scheduleCheckpointInjection(type) {
        const offset = this.config.checkpointOffsetMs || 0;
        if (offset > 0) {
            clog(`checkpoint (${type}) scheduled → ${this.name} (in ${offset / 1000}s)`);
            this.checkpointStartDelay = setTimeout(() => {
                this.checkpointStartDelay = null;
                if (this.status === "idle") {
                    this.injectCheckpoint();
                }
                else {
                    clog(`checkpoint (${type}) queued → ${this.name} (status: ${this.status})`);
                }
            }, offset);
        }
        else {
            if (this.status === "idle") {
                this.injectCheckpoint();
            }
            else {
                clog(`checkpoint (${type}) queued → ${this.name} (status: ${this.status})`);
            }
        }
    }
    stopCheckpointTimers() {
        if (this.checkpointStartDelay) {
            clearTimeout(this.checkpointStartDelay);
            this.checkpointStartDelay = null;
        }
        if (this.checkpointLightTimer) {
            clearInterval(this.checkpointLightTimer);
            this.checkpointLightTimer = null;
        }
        if (this.checkpointFullTimer) {
            clearInterval(this.checkpointFullTimer);
            this.checkpointFullTimer = null;
        }
    }
    injectCheckpoint() {
        if (!this.pendingCheckpoint)
            return;
        const type = this.pendingCheckpoint;
        const intervalMs = type === "full" ? CHECKPOINT_FULL_INTERVAL_MS : CHECKPOINT_LIGHT_INTERVAL_MS;
        const nextTime = fmtNextTime(intervalMs);
        const prompt = type === "full" ? makeCheckpointFullPrompt(nextTime) : makeCheckpointLightPrompt(nextTime);
        this.pendingCheckpoint = null;
        this.checkpointInFlight = true;
        clog(`injecting ${type} checkpoint → ${this.name}`);
        this.ptyProcess.write(prompt);
        this.setStatus("busy");
        this.stopHeuristic();
        setTimeout(() => {
            if (this.status !== "dead")
                this.startHeuristic();
        }, this.config.injectionCooldownMs);
    }
    // --- Layer 4: Dirty state detection on exit ---
    checkDirtyState() {
        return new Promise((resolve) => {
            execFile("git", ["status", "--porcelain"], { cwd: this.workingDir, timeout: 5000 }, (err, stdout) => {
                if (!err && stdout.trim().length > 0) {
                    this.dirtyOnExit = true;
                    log(`[${this.name}] Dirty workspace on exit (${stdout.trim().split("\n").length} changed files)`);
                    this.emit("status-change", this.status);
                }
                resolve();
            });
        });
    }
}
//# sourceMappingURL=session.js.map