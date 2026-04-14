import { existsSync } from "fs";
import { join, resolve } from "path";
import { execSync } from "child_process";
import { binDir, ptyWinDir } from "../lib/paths.js";
import { downloadBinaries } from "../lib/download.js";
import { startEmcomServer, startPtyWin, stopAll } from "../lib/services.js";
import { scaffoldWorkspaces, registerAgents, writeHooks } from "../lib/workspaces.js";
import { binarySuffix } from "../lib/platform.js";

interface StartOptions {
  port: number;
  emcomPort: number;
  dir: string;
  noBrowser: boolean;
  update: boolean;
}

export async function start(opts: StartOptions): Promise<void> {
  console.log("");
  console.log("  fellow-agents");
  console.log("  =============");
  console.log("");

  const workDir = resolve(opts.dir);
  const workspacesDir = join(workDir, "workspaces");
  const emcomUrl = `http://127.0.0.1:${opts.emcomPort}`;

  // 1. Prerequisites
  console.log("[1/7] Checking prerequisites...");
  const nodeVer = process.versions.node;
  const nodeMajor = parseInt(nodeVer.split(".")[0], 10);
  if (nodeMajor < 18) {
    console.error(`  Node.js 18+ required (found ${nodeVer})`);
    process.exit(1);
  }
  console.log(`  Node.js ${nodeVer}`);

  try {
    execSync("claude --version", { stdio: "pipe" });
    console.log("  Claude Code found");
  } catch {
    console.log("  Claude Code not found (optional — install from https://claude.ai/code)");
  }

  // 2. Download binaries
  console.log("[2/7] Downloading binaries...");
  try {
    await downloadBinaries(opts.update);
  } catch (err) {
    console.error(`  Download failed: ${err}`);
    if (!existsSync(join(binDir, `emcom${binarySuffix()}`))) {
      console.error("  No cached binaries available. Check your internet connection.");
      process.exit(1);
    }
    console.log("  Using cached binaries");
  }

  // 3. Install pty-win dependencies
  console.log("[3/7] Installing pty-win...");
  if (existsSync(join(ptyWinDir, "package.json"))) {
    if (!existsSync(join(ptyWinDir, "node_modules"))) {
      execSync("npm install --production", { cwd: ptyWinDir, stdio: "pipe" });
    }
    console.log("  pty-win ready");
  } else {
    console.error("  pty-win not found — download may have failed");
    process.exit(1);
  }

  // 4. Scaffold workspaces
  console.log("[4/7] Scaffolding workspaces...");
  scaffoldWorkspaces(workDir);

  // PATH trick: prepend bin dir so agents find emcom/tracker
  const env = { ...process.env, PATH: `${binDir}${process.platform === "win32" ? ";" : ":"}${process.env.PATH}` };

  // 5. Start emcom-server
  console.log("[5/7] Starting emcom-server...");
  const emcomPid = startEmcomServer(opts.emcomPort, env);
  console.log(`  emcom-server started (pid ${emcomPid})`);

  // Wait for health
  await new Promise<void>((resolve) => {
    let attempts = 0;
    const check = () => {
      const http = require("http");
      http.get(`${emcomUrl}/api/health`, (res: any) => {
        if (res.statusCode === 200) return resolve();
        if (++attempts < 20) setTimeout(check, 500);
        else resolve();
      }).on("error", () => {
        if (++attempts < 20) setTimeout(check, 500);
        else resolve();
      });
    };
    check();
  });
  console.log(`  emcom-server running on :${opts.emcomPort}`);

  // 6. Register agents
  console.log("[6/7] Registering agents + configuring hooks...");
  registerAgents(workspacesDir, env);
  writeHooks(workspacesDir, opts.port);

  // 7. Start pty-win
  console.log("[7/7] Starting pty-win...");
  const ptyPid = startPtyWin(opts.port, workspacesDir, emcomUrl, env);
  console.log(`  pty-win started (pid ${ptyPid})`);

  // Open browser
  if (!opts.noBrowser) {
    setTimeout(() => {
      const url = `http://127.0.0.1:${opts.port}`;
      try {
        if (process.platform === "win32") execSync(`start "" "${url}"`, { stdio: "ignore" });
        else if (process.platform === "darwin") execSync(`open "${url}"`, { stdio: "ignore" });
        else execSync(`xdg-open "${url}" 2>/dev/null || true`, { stdio: "ignore" });
      } catch {}
    }, 2000);
  }

  console.log("");
  console.log("  Setup complete!");
  console.log(`  pty-win:      http://127.0.0.1:${opts.port}`);
  console.log(`  emcom-server: ${emcomUrl}`);
  console.log("");
  console.log("  Press Ctrl+C to stop all services.");
  console.log("");

  // Wait for Ctrl+C
  process.on("SIGINT", () => {
    console.log("\n  Shutting down...");
    stopAll();
    console.log("  Stopped.");
    process.exit(0);
  });

  // Keep alive
  setInterval(() => {}, 60000);
}
