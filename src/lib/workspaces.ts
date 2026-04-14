import { cpSync, mkdirSync, existsSync, readdirSync, writeFileSync } from "fs";
import { join, basename } from "path";
import { execSync } from "child_process";
import { templatesDir, binDir } from "./paths.js";
import { binarySuffix } from "./platform.js";

export function scaffoldWorkspaces(targetDir: string): void {
  const workspacesDir = join(targetDir, "workspaces");
  if (existsSync(workspacesDir) && readdirSync(workspacesDir).length > 0) {
    console.log("  Workspaces already exist — skipping scaffold");
    return;
  }
  console.log("  Scaffolding workspaces from templates...");
  mkdirSync(workspacesDir, { recursive: true });
  cpSync(templatesDir, workspacesDir, { recursive: true });
}

export function registerAgents(workspacesDir: string, env: NodeJS.ProcessEnv): void {
  const emcom = join(binDir, `emcom${binarySuffix()}`);
  const dirs = readdirSync(workspacesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory());

  for (const dir of dirs) {
    const idFile = join(workspacesDir, dir.name, "identity.json");
    if (!existsSync(idFile)) continue;
    try {
      execSync(`"${emcom}" --identity "${idFile}" register --force`, {
        env,
        stdio: "pipe",
        timeout: 10000,
      });
      console.log(`  Registered: ${dir.name}`);
    } catch {
      console.log(`  Warning: failed to register ${dir.name}`);
    }
  }
}

export function writeHooks(workspacesDir: string, ptyWinPort: number): void {
  const dirs = readdirSync(workspacesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory());

  for (const dir of dirs) {
    const claudeDir = join(workspacesDir, dir.name, ".claude");
    mkdirSync(claudeDir, { recursive: true });
    const settings = {
      hooks: {
        Stop: [{ matcher: "", hooks: [{ type: "http", url: `http://127.0.0.1:${ptyWinPort}/api/hook/stop`, timeout: 2 }] }],
        Notification: [{ matcher: "idle_prompt|permission_prompt", hooks: [{ type: "http", url: `http://127.0.0.1:${ptyWinPort}/api/hook/notify`, timeout: 2 }] }],
        UserPromptSubmit: [{ matcher: "", hooks: [{ type: "http", url: `http://127.0.0.1:${ptyWinPort}/api/hook/prompt-submit`, timeout: 2 }] }],
      },
      messageIdleNotifThresholdMs: 5000,
    };
    writeFileSync(join(claudeDir, "settings.local.json"), JSON.stringify(settings, null, 2), "utf-8");
    console.log(`  Hooks configured: ${dir.name}`);
  }
}
