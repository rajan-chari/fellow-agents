export interface SessionConfig {
    name: string;
    command: string;
    args: string[];
    workingDir: string;
    cols: number;
    rows: number;
    emcomIdentity?: string;
    emcomServer?: string;
    pollIntervalMs: number;
    quietThresholdMs: number;
    injectionCooldownMs: number;
    checkpointOffsetMs: number;
    busyTimeoutMs: number;
    mlServiceUrl: string;
    mlDataDir: string;
    mlCollectionMaxSamples: number;
    mlModelPath: string;
}
export interface ServerConfig {
    port: number;
    emcomServer: string;
    rootDirs: string[];
    mlModelPath: string;
}
export declare const DEFAULTS: {
    port: number;
    emcomServer: string;
    pollIntervalMs: number;
    quietThresholdMs: number;
    injectionCooldownMs: number;
    defaultCommand: string;
    busyTimeoutMs: number;
    mlServiceUrl: string;
    mlCollectionMaxSamples: number;
};
