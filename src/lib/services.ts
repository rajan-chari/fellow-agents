import { spawn } from "child_process";
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "fs";
import { join } from "path";
import { pidDir, binDir, ptyWinDir } from "./paths.js";
import { binarySuffix } from "./platform.js";

function writePid(name: string, pid: number): void {
  mkdirSync(pidDir, { recursive: true });
  writeFileSync(join(pidDir, `${name}.pid`), String(pid), "utf-8");
}

function readPid(name: string): number | null {
  const file = join(pidDir, `${name}.pid`);
  if (!existsSync(file)) return null;
  const pid = parseInt(readFileSync(file, "utf-8").trim(), 10);
  return isNaN(pid) ? null : pid;
}

function removePid(name: string): void {
  const file = join(pidDir, `${name}.pid`);
  if (existsSync(file)) rmSync(file);
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function startEmcomServer(emcomPort: number, env: NodeJS.ProcessEnv): number {
  const bin = join(binDir, `emcom-server${binarySuffix()}`);
  const proc = spawn(bin, [], {
    env: { ...env, EMCOM_PORT: String(emcomPort) },
    detached: true,
    stdio: "ignore",
  });
  proc.unref();
  writePid("emcom-server", proc.pid!);
  return proc.pid!;
}

export function startPtyWin(port: number, workspacesDir: string, emcomUrl: string, env: NodeJS.ProcessEnv): number {
  const main = join(ptyWinDir, "dist", "index.js");
  const proc = spawn("node", [main, "--port", String(port), "--root", workspacesDir, "--emcom", emcomUrl], {
    env,
    detached: true,
    stdio: "ignore",
  });
  proc.unref();
  writePid("pty-win", proc.pid!);
  return proc.pid!;
}

export function stopAll(): void {
  for (const name of ["emcom-server", "pty-win"]) {
    const pid = readPid(name);
    if (pid && isRunning(pid)) {
      try {
        process.kill(pid);
        console.log(`  Stopped ${name} (pid ${pid})`);
      } catch {
        console.log(`  Could not stop ${name} (pid ${pid})`);
      }
    } else {
      console.log(`  ${name} not running`);
    }
    removePid(name);
  }
}

export function waitForHealth(url: string, timeoutMs: number = 30000): Promise<boolean> {
  const { get } = require("https").request ? require("https") : require("http");
  const start = Date.now();
  return new Promise((resolve) => {
    const check = () => {
      if (Date.now() - start > timeoutMs) return resolve(false);
      const mod = url.startsWith("https") ? require("https") : require("http");
      mod.get(url, (res: any) => {
        resolve(res.statusCode === 200);
      }).on("error", () => {
        setTimeout(check, 500);
      });
    };
    check();
  });
}
