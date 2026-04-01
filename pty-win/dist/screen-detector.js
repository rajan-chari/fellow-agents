import pkg from "@xterm/headless";
const { Terminal } = pkg;
import { log } from "./log.js";
// Claude Code UI patterns
const INPUT_PROMPT_RE = /^[❯>]\s*$/;
const PERMISSION_PROMPT_RE = /allow|permission|approve|deny|y\/n|yes.*no/i;
const BUSY_ANIMATION_RE = /\S+…\s+\(/;
const STATUS_BAR_RE = /^\s*[▸▶●⏺]\s|@\w+\s+\$|shift.tab|accept\s+edits/i;
export class ScreenDetector {
    terminal;
    sessionName;
    lastDiagTime = 0;
    lastOutputTime = Date.now();
    constructor(cols, rows, sessionName) {
        this.sessionName = sessionName;
        this.terminal = new Terminal({
            cols,
            rows,
            scrollback: 200,
            allowProposedApi: true,
        });
    }
    write(data) {
        this.lastOutputTime = Date.now();
        this.terminal.write(data);
    }
    resize(cols, rows) {
        this.terminal.resize(cols, rows);
    }
    /** Check if output has been quiet for at least thresholdMs */
    isQuiet(thresholdMs) {
        return Date.now() - this.lastOutputTime >= thresholdMs;
    }
    /** Claude-specific: detect what kind of prompt is showing */
    detectPromptType() {
        const buf = this.terminal.buffer.active;
        const contentLines = this.getContentLines(8);
        const now = Date.now();
        if (now - this.lastDiagTime > 10_000) {
            this.lastDiagTime = now;
            const linesDebug = contentLines.map((l, i) => `  [${i}] "${l.slice(-80)}"`).join("\n");
            log(`[${this.sessionName}] Screen diag: cursorY=${buf.cursorY} lines=${contentLines.length}\n${linesDebug}`);
        }
        for (const line of contentLines) {
            if (BUSY_ANIMATION_RE.test(line))
                return "busy";
        }
        const joined = contentLines.join(" ");
        if (PERMISSION_PROMPT_RE.test(joined))
            return "permission";
        for (let i = contentLines.length - 1; i >= 0; i--) {
            if (INPUT_PROMPT_RE.test(contentLines[i]))
                return "input";
        }
        return "unknown";
    }
    getContentLines(n) {
        const buf = this.terminal.buffer.active;
        const lines = [];
        for (let y = this.terminal.rows - 1; y >= 0 && lines.length < n; y--) {
            const line = buf.getLine(buf.baseY + y);
            if (!line)
                continue;
            const text = line.translateToString(true);
            if (text.trim().length === 0)
                continue;
            if (STATUS_BAR_RE.test(text))
                continue;
            lines.unshift(text);
        }
        return lines;
    }
    /** Get last N lines for dashboard preview */
    snapshot(n = 8) {
        const buf = this.terminal.buffer.active;
        const lines = [];
        for (let y = this.terminal.rows - 1; y >= 0 && lines.length < n; y--) {
            const line = buf.getLine(buf.baseY + y);
            if (!line)
                continue;
            const text = line.translateToString(true);
            if (text.trim().length > 0)
                lines.unshift(text);
        }
        return lines;
    }
    dispose() {
        this.terminal.dispose();
    }
}
//# sourceMappingURL=screen-detector.js.map