import { existsSync, rmSync, statSync, readdirSync } from "fs";
import { join } from "path";
import { dataDir, binDir, ptyWinDir, pidDir } from "../lib/paths.js";
import { stopAll } from "../lib/services.js";

function dirSize(path: string): number {
  if (!existsSync(path)) return 0;
  let total = 0;
  const stack = [path];
  while (stack.length > 0) {
    const current = stack.pop()!;
    try {
      const stat = statSync(current);
      if (stat.isDirectory()) {
        for (const entry of readdirSync(current)) stack.push(join(current, entry));
      } else {
        total += stat.size;
      }
    } catch {}
  }
  return total;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function clean(): void {
  console.log("");
  console.log("  Cleaning fellow-agents state...");

  stopAll();

  // Wipe these — logs/ is preserved for postmortem
  const targets = [
    { label: "bin", path: binDir },
    { label: "pty-win", path: ptyWinDir },
    { label: "pid", path: pidDir },
  ];

  let totalFreed = 0;
  for (const t of targets) {
    if (existsSync(t.path)) {
      const size = dirSize(t.path);
      try {
        rmSync(t.path, { recursive: true, force: true });
        console.log(`  Removed ${t.label}/ (${formatBytes(size)})`);
        totalFreed += size;
      } catch (err: any) {
        console.error(`  Failed to remove ${t.label}/: ${err.message}`);
      }
    }
  }

  // Reset version stamp (separate from bin/ since it's nested but worth calling out)
  const versionPath = join(dataDir, "bin", ".version");
  if (existsSync(versionPath)) {
    try { rmSync(versionPath); } catch {}
  }

  console.log("");
  console.log(`  Cleaned ${formatBytes(totalFreed)} from ${dataDir}`);
  console.log(`  Logs preserved at ${join(dataDir, "logs")}`);
  console.log(`  Preferences preserved at ${join(dataDir, "preferences.json")} (if set)`);
  console.log(`  Run 'fellow-agents' to reinstall.`);
  console.log("");
}
