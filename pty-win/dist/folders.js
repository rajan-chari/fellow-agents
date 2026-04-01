import { readdirSync, readFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { log } from "./log.js";
/**
 * List immediate children of a directory with Claude marker detection.
 * Fast: single readdir + sync checks per entry. No recursion.
 */
export function listDir(dirPath) {
    try {
        const entries = readdirSync(dirPath, { withFileTypes: true });
        const results = [];
        for (const entry of entries) {
            // Skip hidden files/dirs (except .claude which we detect inside dirs)
            if (entry.name.startsWith("."))
                continue;
            // Skip common non-project entries
            if (entry.name === "node_modules" || entry.name === "__pycache__" || entry.name === ".git")
                continue;
            const fullPath = join(dirPath, entry.name);
            if (entry.isDirectory()) {
                let isClaudeReady = false;
                let hasIdentity = false;
                let identityName;
                let hasClaudeDir = false;
                try {
                    isClaudeReady = existsSync(join(fullPath, "CLAUDE.md"));
                    hasClaudeDir = existsSync(join(fullPath, ".claude"));
                    const identityPath = join(fullPath, "identity.json");
                    if (existsSync(identityPath)) {
                        hasIdentity = true;
                        try {
                            const raw = JSON.parse(readFileSync(identityPath, "utf-8"));
                            if (typeof raw.name === "string" && raw.name.trim()) {
                                identityName = raw.name;
                            }
                        }
                        catch { }
                    }
                }
                catch { }
                results.push({
                    name: entry.name,
                    path: fullPath,
                    isDir: true,
                    isClaudeReady,
                    hasIdentity,
                    identityName,
                    hasClaudeDir,
                });
            }
        }
        // Sort: directories with CLAUDE.md first, then by name
        results.sort((a, b) => {
            if (a.isClaudeReady !== b.isClaudeReady)
                return a.isClaudeReady ? -1 : 1;
            return a.name.localeCompare(b.name);
        });
        return results;
    }
    catch (err) {
        log(`[folders] Error listing ${dirPath}: ${err}`);
        return [];
    }
}
/**
 * Read identity.json from a directory if it exists.
 */
export function readIdentity(dir) {
    const identityPath = join(dir, "identity.json");
    if (!existsSync(identityPath))
        return null;
    try {
        const raw = JSON.parse(readFileSync(identityPath, "utf-8"));
        if (typeof raw.name === "string" && raw.name.trim() && typeof raw.server === "string" && raw.server.trim()) {
            return { name: raw.name, server: raw.server };
        }
        return null;
    }
    catch {
        return null;
    }
}
/**
 * Create a subdirectory inside parentPath.
 */
export function createDir(parentPath, name) {
    const fullPath = join(parentPath, name);
    if (existsSync(fullPath))
        throw new Error(`Already exists: ${fullPath}`);
    mkdirSync(fullPath);
    return fullPath;
}
//# sourceMappingURL=folders.js.map