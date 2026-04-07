/**
 * Session state machine — pure transition logic extracted from PtySession.
 * Each function takes current state + event, returns new state + side effects.
 * PtySession calls these and executes the side effects.
 */
export function initialState() {
    return {
        status: "starting",
        needsStartupKick: false,
        isResumedSession: false,
        pendingMessages: false,
        pendingCheckpoint: null,
        checkpointInFlight: false,
        checkpointStartDelay: false,
        busyStartTime: 0,
        busyTimeoutSaved: false,
        lastCheckpointTime: 0,
        lastOutputTime: Date.now(),
        costUsd: 0,
    };
}
/** PTY data received */
export function onData(s) {
    const effects = [];
    const next = { ...s, lastOutputTime: Date.now() };
    if (s.status === "idle" || s.status === "starting") {
        next.status = "busy";
        effects.push({ type: "set-status", status: "busy" });
    }
    return { state: next, effects };
}
/** Process exited */
export function onExit(s) {
    return {
        state: { ...s, status: "dead" },
        effects: [{ type: "set-status", status: "dead" }],
    };
}
/** Hook: Claude finished a turn (Stop event) */
export function onHookStop(s) {
    if (s.status === "dead")
        return { state: s, effects: [] };
    const effects = [];
    const next = { ...s };
    if (s.needsStartupKick) {
        next.needsStartupKick = false;
        next.status = "busy";
        effects.push({ type: "inject-startup-kick", resumed: s.isResumedSession });
        effects.push({ type: "set-status", status: "busy" });
        return { state: next, effects };
    }
    next.status = "idle";
    effects.push({ type: "set-status", status: "idle" });
    if (s.checkpointInFlight) {
        next.checkpointInFlight = false;
        next.lastCheckpointTime = Date.now();
        effects.push({ type: "stamp-checkpoint-time" });
    }
    if (s.pendingMessages) {
        effects.push({ type: "inject-emcom" });
    }
    else if (s.pendingCheckpoint && !s.checkpointStartDelay) {
        effects.push({ type: "schedule-checkpoint", kind: s.pendingCheckpoint });
    }
    return { state: next, effects };
}
/** Hook: user/injection submitted input (UserPromptSubmit event) */
export function onHookPromptSubmit(s) {
    if (s.status === "dead")
        return { state: s, effects: [] };
    return {
        state: { ...s, status: "busy", busyStartTime: Date.now(), busyTimeoutSaved: false },
        effects: [{ type: "set-status", status: "busy" }],
    };
}
/** Hook: notification (idle_prompt or permission_prompt) */
export function onHookNotify(s, notifType) {
    if (s.status === "dead")
        return { state: s, effects: [] };
    if (notifType === "idle_prompt") {
        const effects = [];
        const next = { ...s };
        if (s.status !== "idle") {
            next.status = "idle";
            effects.push({ type: "set-status", status: "idle" });
        }
        if (s.pendingMessages) {
            effects.push({ type: "inject-emcom" });
        }
        return { state: next, effects };
    }
    // permission_prompt — no status change
    return { state: s, effects: [] };
}
/** Force idle (from UI context menu) */
export function onForceIdle(s) {
    const effects = [{ type: "set-status", status: "idle" }];
    const next = { ...s, status: "idle" };
    if (s.checkpointInFlight) {
        next.checkpointInFlight = false;
        next.lastCheckpointTime = Date.now();
        effects.push({ type: "stamp-checkpoint-time" });
    }
    if (s.pendingMessages) {
        effects.push({ type: "inject-emcom" });
    }
    return { state: next, effects };
}
/** Heuristic detected idle (screen prompt found) */
export function onHeuristicIdle(s) {
    if (s.status !== "busy")
        return { state: s, effects: [] };
    const effects = [];
    const next = { ...s };
    if (s.needsStartupKick) {
        next.needsStartupKick = false;
        next.status = "busy";
        effects.push({ type: "inject-startup-kick", resumed: s.isResumedSession });
        effects.push({ type: "set-status", status: "busy" });
        return { state: next, effects };
    }
    next.status = "idle";
    effects.push({ type: "set-status", status: "idle" });
    if (s.checkpointInFlight) {
        next.checkpointInFlight = false;
        next.lastCheckpointTime = Date.now();
        effects.push({ type: "stamp-checkpoint-time" });
    }
    if (s.pendingMessages) {
        effects.push({ type: "inject-emcom" });
    }
    else if (s.pendingCheckpoint && !s.checkpointStartDelay) {
        effects.push({ type: "schedule-checkpoint", kind: s.pendingCheckpoint });
    }
    return { state: next, effects };
}
//# sourceMappingURL=session-state.js.map