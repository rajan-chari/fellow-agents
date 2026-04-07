export type PromptType = "input" | "permission" | "busy" | "unknown";
export declare class ScreenDetector {
    private terminal;
    private sessionName;
    private lastDiagTime;
    private lastOutputTime;
    constructor(cols: number, rows: number, sessionName: string);
    write(data: string): void;
    resize(cols: number, rows: number): void;
    /** Check if output has been quiet for at least thresholdMs */
    isQuiet(thresholdMs: number): boolean;
    /** Claude-specific: detect what kind of prompt is showing */
    detectPromptType(): PromptType;
    getContentLines(n: number): string[];
    /** Get last N lines for dashboard preview */
    snapshot(n?: number): string[];
    dispose(): void;
}
