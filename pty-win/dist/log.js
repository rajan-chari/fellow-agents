import { appendFileSync } from "fs";
import { join } from "path";
const logPath = join(process.cwd(), "pty-win.log");
export function log(msg) {
    const ts = new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
    appendFileSync(logPath, `[${ts}] ${msg}\n`);
}
export function clog(msg) {
    const ts = new Date().toLocaleTimeString("en-US", { hour12: false });
    console.log(`[pty-win ${ts}] ${msg}`);
    log(msg);
}
//# sourceMappingURL=log.js.map