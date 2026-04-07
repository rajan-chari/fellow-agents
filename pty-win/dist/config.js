export const DEFAULTS = {
    port: 3600,
    emcomServer: "http://127.0.0.1:8800",
    pollIntervalMs: 1000,
    quietThresholdMs: 1000,
    injectionCooldownMs: 30000,
    defaultCommand: process.platform === "win32" ? "cmd.exe" : "/bin/bash",
    busyTimeoutMs: 5 * 60 * 1000,
    mlServiceUrl: "http://127.0.0.1:8710",
    mlCollectionMaxSamples: 1000,
};
//# sourceMappingURL=config.js.map