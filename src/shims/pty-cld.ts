#!/usr/bin/env node

import { execFileSync } from "child_process";
import { join } from "path";
import { existsSync } from "fs";

// pty-cld lives alongside pty-win in the data directory
import { dataDir } from "../lib/paths.js";

const ptyCldDir = join(dataDir, "pty-cld");
const main = join(ptyCldDir, "dist", "index.js");

if (!existsSync(main)) {
  console.error("pty-cld not found. Run 'fellow-agents' first to download binaries.");
  process.exit(1);
}
try {
  execFileSync("node", [main, ...process.argv.slice(2)], { stdio: "inherit" });
} catch (err: any) {
  process.exit(err.status ?? 1);
}
