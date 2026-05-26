import { homedir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { detectPlatform } from "./platform.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** ~/.fellow-agents/ */
export const dataDir = join(homedir(), ".fellow-agents");

/** ~/.fellow-agents/bin/{platform}/ */
export const binDir = join(dataDir, "bin", detectPlatform());

/** ~/.fellow-agents/pty-win/ */
export const ptyWinDir = join(dataDir, "pty-win");

/** ~/.fellow-agents/pid/ */
export const pidDir = join(dataDir, "pid");

/** ~/.fellow-agents/logs/ */
export const logsDir = join(dataDir, "logs");

/** ~/.fellow-agents/bin/.version */
export const versionFile = join(dataDir, "bin", ".version");

/** templates/ directory shipped with the npm package */
export const templatesDir = join(__dirname, "..", "..", "templates");

/** skills/ directory shipped with the npm package */
export const skillsDir = join(__dirname, "..", "..", "skills");
