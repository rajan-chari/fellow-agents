export interface FolderEntry {
    name: string;
    path: string;
    isDir: boolean;
    isClaudeReady: boolean;
    hasIdentity: boolean;
    identityName?: string;
    hasClaudeDir: boolean;
}
/**
 * List immediate children of a directory with Claude marker detection.
 * Fast: single readdir + sync checks per entry. No recursion.
 */
export declare function listDir(dirPath: string): FolderEntry[];
/**
 * Read identity.json from a directory if it exists.
 */
export declare function readIdentity(dir: string): {
    name: string;
    server: string;
} | null;
/**
 * Create a subdirectory inside parentPath.
 */
export declare function createDir(parentPath: string, name: string): string;
