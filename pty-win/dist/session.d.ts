import { EventEmitter } from "events";
import type { SessionConfig } from "./config.js";
export type SessionStatus = "starting" | "busy" | "idle" | "dead";
export interface StatsBucket {
    callbacksPerSec: number;
    bytesPerSec: number;
    avgChunkBytes: number;
}
export interface SessionStats {
    name: string;
    status: SessionStatus;
    overall: StatsBucket;
    busy: StatsBucket;
    notBusy: StatsBucket;
}
export interface SessionInfo {
    name: string;
    group: string;
    command: string;
    workingDir: string;
    pid: number;
    status: SessionStatus;
    emcomIdentity?: string;
    unreadCount: number;
    dirtyOnExit: boolean;
}
export declare class PtySession extends EventEmitter {
    private config;
    private ptyProcess;
    private poller;
    private identityWatcher;
    private screenDetector;
    private heuristicTimer;
    private checkpointStartDelay;
    private checkpointLightTimer;
    private checkpointFullTimer;
    private pendingCheckpoint;
    private checkpointInFlight;
    private lastCheckpointTime;
    private status;
    private pendingMessages;
    private unreadCount;
    private lastOutputTime;
    private needsStartupKick;
    private isResumedSession;
    private dirtyOnExit;
    private busyStartTime;
    private busyTimeoutSaved;
    private lastSavedLabel;
    private lastSavedAt;
    private mlQueryInFlight;
    private dataEvents;
    readonly name: string;
    readonly command: string;
    readonly workingDir: string;
    constructor(config: SessionConfig);
    start(): void;
    stop(): void;
    write(data: string | Buffer): void;
    resize(cols: number, rows: number): void;
    kill(): void;
    getPid(): number;
    getStatus(): SessionStatus;
    getInfo(): SessionInfo;
    getSnapshot(n?: number): string[];
    clearUnread(): void;
    /** Force session to idle — triggers emcom injection if messages are pending. */
    forceIdle(): void;
    /** Trigger emcom injection immediately (for quick-message send from UI). */
    injectEmcom(): void;
    getContentLines(n: number): string[];
    getStats(): SessionStats;
    applyMLInference(label: string, confidence: number): void;
    /**
     * Periodically check for identity.json appearing in the session's working dir.
     * Once found, attach emcom poller and stop watching.
     */
    private watchForIdentity;
    private stopIdentityWatcher;
    /**
     * Dynamically attach emcom polling to a session that started without it.
     */
    private attachEmcom;
    private setStatus;
    private startHeuristic;
    private stopHeuristic;
    private inject;
    private startCheckpointTimers;
    /** Stagger checkpoint injection by repo offset — runs every round, not just the first. */
    private scheduleCheckpointInjection;
    private stopCheckpointTimers;
    private injectCheckpoint;
    private checkDirtyState;
}
