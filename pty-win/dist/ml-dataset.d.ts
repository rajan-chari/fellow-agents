export type MlLabel = "busy" | "not_busy";
export type MlConfidence = "auto" | "strong" | "uncertain";
export type MlSource = "auto_detect" | "force_idle" | "timeout_flag";
export declare function saveMlSample(dataDir: string, textLines: string[], label: MlLabel, confidence: MlConfidence, source: MlSource, sessionId: string, maxAutoDetectSamples?: number): void;
