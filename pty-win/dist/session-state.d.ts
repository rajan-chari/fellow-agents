/**
 * Session state machine — pure transition logic extracted from PtySession.
 * Each function takes current state + event, returns new state + side effects.
 * PtySession calls these and executes the side effects.
 */
export type SessionStatus = "starting" | "busy" | "idle" | "dead";
export interface SessionState {
    status: SessionStatus;
    needsStartupKick: boolean;
    isResumedSession: boolean;
    pendingMessages: boolean;
    pendingCheckpoint: "light" | "full" | null;
    checkpointInFlight: boolean;
    checkpointStartDelay: boolean;
    busyStartTime: number;
    busyTimeoutSaved: boolean;
    lastCheckpointTime: number;
    lastOutputTime: number;
    costUsd: number;
}
export type SideEffect = {
    type: "set-status";
    status: SessionStatus;
} | {
    type: "inject-emcom";
} | {
    type: "inject-startup-kick";
    resumed: boolean;
} | {
    type: "schedule-checkpoint";
    kind: "light" | "full";
} | {
    type: "stamp-checkpoint-time";
};
export interface Transition {
    state: SessionState;
    effects: SideEffect[];
}
export declare function initialState(): SessionState;
/** PTY data received */
export declare function onData(s: SessionState): Transition;
/** Process exited */
export declare function onExit(s: SessionState): Transition;
/** Hook: Claude finished a turn (Stop event) */
export declare function onHookStop(s: SessionState): Transition;
/** Hook: user/injection submitted input (UserPromptSubmit event) */
export declare function onHookPromptSubmit(s: SessionState): Transition;
/** Hook: notification (idle_prompt or permission_prompt) */
export declare function onHookNotify(s: SessionState, notifType: string): Transition;
/** Force idle (from UI context menu) */
export declare function onForceIdle(s: SessionState): Transition;
/** Heuristic detected idle (screen prompt found) */
export declare function onHeuristicIdle(s: SessionState): Transition;
