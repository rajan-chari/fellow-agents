import { existsSync, rmSync, statSync, readdirSync } from "fs";
import { join, resolve } from "path";
import { dataDir } from "../lib/paths.js";
import { stopAll } from "../lib/services.js";

interface UninstallOptions {
  dir: string;
  yes: boolean;
}

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

export function uninstall(opts: UninstallOptions): void {
  const workDir = resolve(opts.dir);

  // Two possible workspace locations — start.ts uses either depending on whether cwd has workspaces/
  const wsCandidates = [
    join(workDir, "workspaces"),
    join(workDir, "fellow-agents", "workspaces"),
  ];

  const targets: { label: string; path: string; size: number }[] = [];

  if (existsSync(dataDir)) {
    targets.push({ label: "Data directory", path: dataDir, size: dirSize(dataDir) });
  }
  for (const ws of wsCandidates) {
    if (existsSync(ws)) {
      targets.push({ label: "Workspaces", path: ws, size: dirSize(ws) });
    }
  }

  console.log("");
  console.log("  fellow-agents uninstall");
  console.log("  =======================");
  console.log("");

  if (targets.length === 0) {
    console.log("  Nothing to remove — no fellow-agents state found.");
    console.log("");
    console.log("  To uninstall the npm package itself, run:");
    console.log("    npm uninstall -g fellow-agents");
    console.log("");
    return;
  }

  const totalSize = targets.reduce((sum, t) => sum + t.size, 0);

  console.log("  The following will be permanently removed:");
  console.log("");
  for (const t of targets) {
    console.log(`    ${t.path}  (${formatBytes(t.size)})`);
  }
  console.log("");
  console.log(`  Total: ${formatBytes(totalSize)}`);
  console.log("");

  if (!opts.yes) {
    console.log("  This is a dry run. To proceed, add --yes:");
    console.log("    fellow-agents uninstall --yes");
    console.log("");
    console.log("  Tip: pass --dir <path> if your workspaces are elsewhere.");
    console.log("");
    return;
  }

  // Actually do the uninstall
  console.log("  Stopping services...");
  stopAll();
  console.log("");

  for (const t of targets) {
    try {
      rmSync(t.path, { recursive: true, force: true });
      console.log(`  Removed ${t.path}`);
    } catch (err: any) {
      console.error(`  Failed to remove ${t.path}: ${err.message}`);
    }
  }

  console.log("");
  console.log("  fellow-agents state removed.");
  console.log("");
  console.log("  To uninstall the npm package itself, run:");
  console.log("    npm uninstall -g fellow-agents");
  console.log("");
}
