import { appendFile, mkdirSync, existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
const MAX_RECORDS_PER_FILE = 250;
// Module-level state — initialized lazily on first saveMlSample call
let initialized = false;
let currentFileIndex = 1;
let currentFileRecords = 0;
let autoDetectCount = 0;
function init(dataDir) {
    if (initialized)
        return;
    initialized = true;
    if (!existsSync(dataDir))
        return; // fresh start, defaults are correct
    const files = readdirSync(dataDir)
        .filter((f) => /^labels-\d+\.jsonl$/.test(f))
        .sort();
    if (files.length === 0)
        return;
    // Count auto_detect records across all files
    for (const file of files) {
        const content = readFileSync(join(dataDir, file), "utf8");
        for (const line of content.split("\n")) {
            if (!line.trim())
                continue;
            try {
                const rec = JSON.parse(line);
                if (rec.source === "auto_detect")
                    autoDetectCount++;
            }
            catch { /* skip malformed lines */ }
        }
    }
    // Resume from last file
    const lastFile = files[files.length - 1];
    const match = lastFile.match(/labels-(\d+)\.jsonl$/);
    currentFileIndex = match ? parseInt(match[1], 10) : 1;
    const content = readFileSync(join(dataDir, lastFile), "utf8");
    currentFileRecords = content.split("\n").filter((l) => l.trim()).length;
    // If last file is already full, advance to next
    if (currentFileRecords >= MAX_RECORDS_PER_FILE) {
        currentFileIndex++;
        currentFileRecords = 0;
    }
}
export function saveMlSample(dataDir, textLines, label, confidence, source, sessionId, maxAutoDetectSamples = Number.MAX_SAFE_INTEGER) {
    if (!existsSync(dataDir))
        mkdirSync(dataDir, { recursive: true });
    init(dataDir);
    // auto_detect is capped; force_idle and timeout_flag always save
    if (source === "auto_detect" && autoDetectCount >= maxAutoDetectSamples)
        return;
    // Rotate to a new file if current is full
    if (currentFileRecords >= MAX_RECORDS_PER_FILE) {
        currentFileIndex++;
        currentFileRecords = 0;
    }
    const filename = `labels-${String(currentFileIndex).padStart(3, "0")}.jsonl`;
    const record = {
        text_lines: textLines,
        label,
        confidence,
        source,
        timestamp: new Date().toISOString(),
        session_id: sessionId,
    };
    appendFile(join(dataDir, filename), JSON.stringify(record) + "\n", "utf8", () => { });
    currentFileRecords++;
    if (source === "auto_detect")
        autoDetectCount++;
}
//# sourceMappingURL=ml-dataset.js.map