#!/usr/bin/env node

import { execFileSync } from "child_process";
import { join } from "path";
import { existsSync } from "fs";
import { ptyWinDir } from "../lib/paths.js";

const main = join(ptyWinDir, "dist", "index.js");
if (!existsSync(main)) {
  console.error("pty-win not found. Run 'fellow-agents' first to download binaries.");
  process.exit(1);
}
try {
  execFileSync("node", [main, ...process.argv.slice(2)], { stdio: "inherit" });
} catch (err: any) {
  process.exit(err.status ?? 1);
}
