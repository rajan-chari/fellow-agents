/**
 * Pane groups — consolidates Claude + PowerShell sessions per folder into groups.
 * Extracted from public/app.js for testability.
 */
export interface SessionInfo {
    name: string;
    group: string;
    command: string;
    status: string;
    [key: string]: unknown;
}
export interface PaneGroup {
    claude?: string;
    pwsh?: string;
    activeType: "claude" | "pwsh";
}
/**
 * Rebuild pane groups from a sessions map.
 * Groups Claude and PowerShell sessions by folder basename.
 * Preserves activeType from previous groups where possible.
 */
export declare function rebuildPaneGroups(sessions: Map<string, SessionInfo>, prevGroups: Map<string, PaneGroup>): Map<string, PaneGroup>;
