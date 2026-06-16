import { existsSync, readFileSync, mkdirSync, writeFileSync } from "fs";
import http from "http";
import { join, resolve } from "path";
import { execSync } from "child_process";
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { binDir, ptyWinDir, logsDir, dataDir } from "../lib/paths.js";
import { downloadBinaries } from "../lib/download.js";
import { startEmcomServer, startPtyWin, stopAll, logPath, waitForHealth } from "../lib/services.js";
import { scaffoldWorkspaces, registerAgents, writeHooks } from "../lib/workspaces.js";
import { installSkills } from "../lib/skills.js";
import { binarySuffix } from "../lib/platform.js";
import {
  readPreferences,
  writePreferences,
  autoDetectClis,
  lookupCli,
  stripMatchedQuotes,
} from "../lib/preferences.js";

interface StartOptions {
  port: number;
  emcomPort: number;
  dir: string;
  noBrowser: boolean;
  update: boolean;
}

// Minimal engines.node range check — handles ">=N", "<N", and combinations.
function nodeInRange(version: string, range: string): boolean {
  const major = parseInt(version.split(".")[0], 10);
  const minMatch = range.match(/>=?\s*(\d+)/);
  const maxMatch = range.match(/<\s*(\d+)/);
  const min = minMatch ? parseInt(minMatch[1], 10) : 0;
  const max = maxMatch ? parseInt(maxMatch[1], 10) : Infinity;
  return major >= min && major < max;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function printStartFailureAdvice(context: "download" | "emcom-server" | "pty-win" | "pty-win-install", opts: StartOptions): void {
  console.error("");
  console.error("  Troubleshooting:");
  if (context === "download") {
    console.error("    - Run 'fellow-agents status' to inspect cached release and binary paths.");
    console.error("    - Retry with 'fellow-agents --update' after confirming network/GitHub access.");
    console.error("    - If the cache looks stale or partial, run 'fellow-agents clean' and then 'fellow-agents'.");
  } else if (context === "pty-win-install") {
    console.error(`    - Check the pty-win log path: ${logPath("pty-win")}`);
    console.error(`    - Retry after 'fellow-agents clean' if node_modules is partial or stale.`);
    console.error(`    - Run 'fellow-agents status' to inspect Node version and pty-win build info.`);
  } else {
    const service = context === "emcom-server" ? "emcom-server" : "pty-win";
    const port = context === "emcom-server" ? opts.emcomPort : opts.port;
    console.error(`    - Check logs: ${logPath(service)}`);
    console.error(`    - If port ${port} is busy, run 'fellow-agents stop' or retry with ${context === "emcom-server" ? "--emcom-port" : "--port"} <number>.`);
    console.error("    - Run 'fellow-agents status' to inspect service health, PIDs, and PATH resolution.");
  }
  console.error("");
}

export function formatSetupComplete(opts: {
  browserUrl: string;
  emcomUrl: string;
  workspaceRoot: string;
  cliPreference: string | null;
  logDir: string;
}): string {
  const cliPreference = opts.cliPreference?.trim() ? opts.cliPreference : "(unset; configure with fellow-agents config set cliPreference <name-or-path>)";
  return [
    "",
    "  Setup complete!",
    `  Browser UI:      ${opts.browserUrl}`,
    `  emcom API:       ${opts.emcomUrl}`,
    `  Workspace root:  ${opts.workspaceRoot}`,
    `  CLI preference:  ${cliPreference}`,
    `  Logs:            ${opts.logDir}`,
    "",
    "  Useful commands:",
    "    fellow-agents stop                         Stop emcom-server and pty-win",
    "    fellow-agents clean                        Reinstall cached binaries/pty-win next run; preserves logs and preferences",
    "    fellow-agents --update                     Force re-download release assets",
    "    fellow-agents config get cliPreference     Show the CLI launched by pty-win",
    "    fellow-agents config set cliPreference <v> Set the CLI launched by pty-win",
    "    fellow-agents status                       Read-only troubleshooting diagnostics",
    "",
    "  Press Ctrl+C to stop all services.",
    "",
  ].join("\n");
}

/**
 * First-run CLI preference prompt. Returns the chosen value (bare command or full path),
 * or null if we should skip (non-interactive, or user declined).
 *
 * Design (locked 5/27 with milo):
 * - Native readline (no inquirer dep — start.ts is a setup pipeline, not a chat UI)
 * - Auto-detected CLIs from PATH shown as numbered choices, plus a "Custom path" option
 * - If user types a custom value not on PATH, single confirm: "Use it anyway? [y/N]"
 * - Non-interactive stdin (CI, piped) → return null, caller logs a hint
 */
async function promptForCliPreference(): Promise<string | null> {
  if (!input.isTTY) return null;

  const detected = autoDetectClis();
  const rl = readline.createInterface({ input, output });

  try {
    console.log("");
    console.log("  Pick your preferred CLI — pty-win's play button will launch this in each new tab.");
    console.log("  (You can change it later with 'fellow-agents config set cliPreference <name>'.)");
    console.log("");

    const choices: string[] = [...detected];
    if (detected.length > 0) {
      for (let i = 0; i < detected.length; i++) {
        console.log(`    [${i + 1}] ${detected[i]}`);
      }
    } else {
      console.log("    (None of claude/copilot/pi found on PATH — pick Custom path to specify your own)");
    }
    const customIdx = choices.length + 1;
    console.log(`    [${customIdx}] Custom path or other command`);
    console.log(`    [s] Skip for now`);
    console.log("");

    const answer = (await rl.question("  Choice: ")).trim().toLowerCase();

    if (answer === "s" || answer === "skip" || answer === "") {
      console.log("  Skipped — pty-win will pick a default until you set one.");
      return null;
    }

    const num = parseInt(answer, 10);
    if (!isNaN(num) && num >= 1 && num <= detected.length) {
      return detected[num - 1];
    }

    if (!isNaN(num) && num === customIdx) {
      const raw = (await rl.question("  Enter command or full path: ")).trim();
      const value = stripMatchedQuotes(raw).trim();
      if (!value) {
        console.log("  Empty input — skipped.");
        return null;
      }
      // Confirm step if value doesn't resolve and doesn't look like a path
      const looksLikePath = value.includes("\\") || value.includes("/");
      const resolved = lookupCli(value);
      if (resolved === null && !looksLikePath) {
        const tool = process.platform === "win32" ? "where.exe" : "which";
        console.log(`  '${tool} ${value}' returned no matches.`);
        const confirm = (await rl.question("  Use it anyway? [y/N]: ")).trim().toLowerCase();
        if (confirm !== "y" && confirm !== "yes") {
          console.log("  Skipped.");
          return null;
        }
      }
      return value;
    }

    console.log(`  Unrecognised choice '${answer}' — skipped.`);
    return null;
  } finally {
    rl.close();
  }
}

export async function start(opts: StartOptions): Promise<void> {
  console.log("");
  console.log("  fellow-agents");
  console.log("  =============");
  console.log("");

  // First-run welcome — show a brief orientation the very first time someone
  // types `fellow-agents`. Marker lives in dataDir so it survives across
  // sessions but resets if the user runs `fellow-agents uninstall`.
  const firstRunMarker = join(dataDir, ".first-run");
  if (!existsSync(firstRunMarker)) {
    console.log("  Welcome! This is your first run. Here's what's about to happen:");
    console.log("");
    console.log("    [1] Download platform binaries (emcom, tracker, emcom-server)");
    console.log("    [2] Install pty-win (the browser-based terminal multiplexer)");
    console.log("    [3] Scaffold three agent workspaces (coder, coordinator, reviewer)");
    console.log("    [4] Install agent skills into ~/.claude/, ~/.copilot/, ~/.agents/");
    console.log("    [5] Start emcom-server and pty-win, open the browser UI");
    console.log("");
    console.log("  Press Ctrl+C any time to stop. `fellow-agents --help` shows options.");
    console.log("");
    try {
      mkdirSync(dataDir, { recursive: true });
      writeFileSync(firstRunMarker, new Date().toISOString());
    } catch {}
  }

  // CLI preference prompt — fires when preferences.json is missing or has no cliPreference.
  // Independent of the first-run marker so a user who wipes preferences.json (or upgrades from
  // a pre-0.0.22 install) gets prompted on the next run. Non-interactive sessions skip silently.
  const existingPrefs = readPreferences();
  let activeCliPreference = existingPrefs?.cliPreference ?? null;
  if (existingPrefs === null || !existingPrefs.cliPreference) {
    const chosen = await promptForCliPreference();
    if (chosen) {
      try {
        writePreferences({
          ...(existingPrefs ?? {}),
          cliPreference: chosen,
          updatedBy: "first-run-prompt",
        });
        activeCliPreference = chosen;
        console.log(`  CLI preference set: ${chosen}`);
        console.log("");
      } catch (err: any) {
        console.error(`  Failed to write preferences: ${err.message}`);
        console.error(`  Continuing without a stored preference.`);
        console.log("");
      }
    } else if (!input.isTTY) {
      console.log("  (non-interactive — skipping CLI preference setup)");
      console.log(`  Set later with: fellow-agents config set cliPreference <name-or-path>`);
      console.log("");
    }
  }

  // Auto-create fellow-agents/ subdirectory if CWD doesn't already have workspaces/
  let workDir = resolve(opts.dir);
  if (!existsSync(join(workDir, "workspaces"))) {
    workDir = join(workDir, "fellow-agents");
    const { mkdirSync } = await import("fs");
    mkdirSync(workDir, { recursive: true });
    console.log(`  Working directory: ${workDir}`);
  }
  const workspacesDir = join(workDir, "workspaces");
  const emcomUrl = `http://127.0.0.1:${opts.emcomPort}`;

  // 1. Prerequisites
  console.log("[1/8] Checking prerequisites...");
  const nodeVer = process.versions.node;
  const nodeMajor = parseInt(nodeVer.split(".")[0], 10);
  if (nodeMajor < 18) {
    console.error(`  Node.js 18+ required (found ${nodeVer})`);
    process.exit(1);
  }
  console.log(`  Node.js ${nodeVer}`);

  try {
    execSync("claude --version", { stdio: "pipe" });
    console.log("  Claude Code found");
  } catch {
    console.log("  Claude Code not found (optional — install from https://claude.ai/code)");
  }

  // 2. Download binaries
  console.log("[2/8] Downloading binaries...");
  try {
    await downloadBinaries(opts.update);
  } catch (err) {
    console.error(`  Download failed: ${errorMessage(err)}`);
    printStartFailureAdvice("download", opts);
    if (!existsSync(join(binDir, `emcom${binarySuffix()}`))) {
      console.error("  No cached binaries available, so setup cannot continue.");
      process.exit(1);
    }
    console.log("  Using cached binaries");
  }

  // 3. Install pty-win dependencies
  console.log("[3/8] Installing pty-win...");
  const ptyPkgPath = join(ptyWinDir, "package.json");
  if (!existsSync(ptyPkgPath)) {
    console.error("  pty-win not found — download may have failed");
    printStartFailureAdvice("download", opts);
    process.exit(1);
  }

  // Warn fail-fast if Node is outside pty-win's supported range
  try {
    const ptyPkg = JSON.parse(readFileSync(ptyPkgPath, "utf-8"));
    const range = ptyPkg.engines?.node;
    if (range && !nodeInRange(nodeVer, range)) {
      console.error(`  WARNING: pty-win supports Node ${range}, you have ${nodeVer}.`);
      console.error(`  Install may fail. Consider using Node 22 LTS.`);
    }
  } catch {}

  // Probe for a real dep instead of just node_modules/ — partial installs leave the dir but miss packages
  const expressInstalled = existsSync(join(ptyWinDir, "node_modules", "express", "package.json"));
  if (!expressInstalled) {
    try {
      execSync("npm install --omit=dev", { cwd: ptyWinDir, stdio: "inherit" });
    } catch (err: any) {
      console.error(`  pty-win install failed: ${errorMessage(err)}`);
      printStartFailureAdvice("pty-win-install", opts);
      process.exit(1);
    }
  }
  console.log("  pty-win ready");

  // 4. Scaffold workspaces
  console.log("[4/8] Scaffolding workspaces...");
  scaffoldWorkspaces(workDir);

  // 5. Install AI skills (SKILL.md files) to known CLI paths
  console.log("[5/8] Installing skills...");
  const skillResult = installSkills();
  const skillTotal = skillResult.written.length + skillResult.refreshed.length + skillResult.skipped.length;
  if (skillTotal === 0) {
    console.log("  No bundled skills");
  } else {
    if (skillResult.written.length > 0) {
      console.log(`  Installed ${skillResult.written.length} skill file(s)`);
    }
    if (skillResult.refreshed.length > 0) {
      console.log(`  Refreshed ${skillResult.refreshed.length} skill file(s) to latest`);
    }
    if (skillResult.skipped.length > 0) {
      console.log(`  Preserved ${skillResult.skipped.length} existing skill file(s) — customized or unowned`);
    }
  }

  // PATH trick: prepend bin dir so agents find emcom/tracker
  const env = { ...process.env, PATH: `${binDir}${process.platform === "win32" ? ";" : ":"}${process.env.PATH}` };

  // 6. Start emcom-server
  console.log("[6/8] Starting emcom-server...");
  const emcomPid = startEmcomServer(opts.emcomPort, env);
  if (emcomPid < 0) {
    printStartFailureAdvice("emcom-server", opts);
    process.exit(1);
  }
  console.log(`  emcom-server started (pid ${emcomPid})`);

  // Wait for health
  const healthy = await new Promise<boolean>((resolve) => {
    let attempts = 0;
    const check = () => {
      http.get(`${emcomUrl}/api/health`, (res) => {
        if (res.statusCode === 200) return resolve(true);
        if (++attempts < 20) setTimeout(check, 500);
        else resolve(false);
      }).on("error", () => {
        if (++attempts < 20) setTimeout(check, 500);
        else resolve(false);
      });
    };
    check();
  });
  if (healthy) {
    console.log(`  emcom-server running on :${opts.emcomPort}`);
  } else {
    console.error(`  Warning: emcom-server health check failed — it may not be running`);
    printStartFailureAdvice("emcom-server", opts);
  }

  // 7. Register agents
  console.log("[7/8] Registering agents + configuring hooks...");
  registerAgents(workspacesDir, env);
  writeHooks(workspacesDir, opts.port);

  // 8. Start pty-win
  console.log("[8/8] Starting pty-win...");
  const ptyMain = join(ptyWinDir, "dist", "index.js");
  if (!existsSync(ptyMain)) {
    console.error(`  pty-win entrypoint not found at ${ptyMain}`);
    printStartFailureAdvice("download", opts);
    process.exit(1);
  }
  const ptyPid = startPtyWin(opts.port, workspacesDir, emcomUrl, env);
  console.log(`  pty-win started (pid ${ptyPid})`);
  const ptyHealthy = await waitForHealth(`http://127.0.0.1:${opts.port}/`, 30_000);
  if (ptyHealthy) {
    console.log(`  pty-win running on :${opts.port}`);
  } else {
    console.error(`  Warning: pty-win health check failed — browser UI may not be ready`);
    printStartFailureAdvice("pty-win", opts);
  }

  // Open browser
  if (!opts.noBrowser) {
    setTimeout(() => {
      const url = `http://127.0.0.1:${opts.port}`;
      try {
        if (process.platform === "win32") execSync(`start "" "${url}"`, { stdio: "ignore" });
        else if (process.platform === "darwin") execSync(`open "${url}"`, { stdio: "ignore" });
        else execSync(`xdg-open "${url}" 2>/dev/null || true`, { stdio: "ignore" });
      } catch {}
    }, 2000);
  }

  console.log(formatSetupComplete({
    browserUrl: `http://127.0.0.1:${opts.port}`,
    emcomUrl,
    workspaceRoot: workspacesDir,
    cliPreference: activeCliPreference,
    logDir: logsDir,
  }));

  // Wait for Ctrl+C
  process.on("SIGINT", () => {
    console.log("\n  Shutting down...");
    stopAll();
    console.log("  Stopped.");
    process.exit(0);
  });

  // Keep alive
  setInterval(() => {}, 60000);
}
