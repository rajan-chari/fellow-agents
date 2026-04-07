/**
 * Pane groups — consolidates Claude + PowerShell sessions per folder into groups.
 * Extracted from public/app.js for testability.
 */
/**
 * Rebuild pane groups from a sessions map.
 * Groups Claude and PowerShell sessions by folder basename.
 * Preserves activeType from previous groups where possible.
 */
export function rebuildPaneGroups(sessions, prevGroups) {
    // Preserve activeType selections across rebuilds
    const prevActive = new Map();
    for (const [g, pg] of prevGroups)
        prevActive.set(g, pg.activeType);
    const groups = new Map();
    for (const [name, info] of sessions) {
        const group = info.group || name;
        if (!groups.has(group)) {
            groups.set(group, { activeType: prevActive.get(group) || "claude" });
        }
        const pg = groups.get(group);
        if (name.endsWith("~pwsh")) {
            pg.pwsh = name;
        }
        else {
            pg.claude = name;
        }
    }
    // If activeType points to a dead/missing session, flip to the other
    for (const [, pg] of groups) {
        if (pg.activeType === "pwsh" && !pg.pwsh)
            pg.activeType = "claude";
        if (pg.activeType === "claude" && !pg.claude)
            pg.activeType = "pwsh";
    }
    return groups;
}
//# sourceMappingURL=pane-groups.js.map