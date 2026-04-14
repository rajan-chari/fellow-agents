#!/usr/bin/env node

import { execFileSync } from "child_process";
import { join } from "path";
import { existsSync } from "fs";
import { binDir } from "../lib/paths.js";
import { binarySuffix } from "../lib/platform.js";

export function runBinary(name: string): void {
  const bin = join(binDir, `${name}${binarySuffix()}`);
  if (!existsSync(bin)) {
    console.error(`${name} not found. Run 'fellow-agents' first to download binaries.`);
    process.exit(1);
  }
  try {
    execFileSync(bin, process.argv.slice(2), { stdio: "inherit" });
  } catch (err: any) {
    process.exit(err.status ?? 1);
  }
}
