import { cpSync, mkdirSync, existsSync, readdirSync, writeFileSync, readFileSync } from "fs";
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

type Settings = Record<string, unknown>;
type HookEntry = Record<string, unknown>;

const PTY_WIN_HOOKS: Record<string, HookEntry> = {
  Stop: { matcher: "", hooks: [{ type: "http", url: "", timeout: 2 }] },
  Notification: { matcher: "idle_prompt|permission_prompt", hooks: [{ type: "http", url: "", timeout: 2 }] },
  UserPromptSubmit: { matcher: "", hooks: [{ type: "http", url: "", timeout: 2 }] },
};

const PTY_WIN_ENDPOINTS: Record<string, string> = {
  Stop: "/api/hook/stop",
  Notification: "/api/hook/notify",
  UserPromptSubmit: "/api/hook/prompt-submit",
};

function readSettings(settingsPath: string): Settings {
  if (!existsSync(settingsPath)) return {};
  try {
    const parsed = JSON.parse(readFileSync(settingsPath, "utf-8")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Settings
      : {};
  } catch {
    return {};
  }
}

function hookEntryFor(event: string, ptyWinPort: number): HookEntry {
  const endpoint = PTY_WIN_ENDPOINTS[event];
  const template = PTY_WIN_HOOKS[event];
  return {
    ...template,
    hooks: [{ type: "http", url: `http://127.0.0.1:${ptyWinPort}${endpoint}`, timeout: 2 }],
  };
}

function isPtyWinHookEntry(entry: unknown, event: string): boolean {
  if (!entry || typeof entry !== "object") return false;
  const hooks = (entry as { hooks?: unknown }).hooks;
  if (!Array.isArray(hooks)) return false;
  const endpoint = PTY_WIN_ENDPOINTS[event];
  return hooks.some((hook) => {
    if (!hook || typeof hook !== "object") return false;
    const url = (hook as { url?: unknown }).url;
    return typeof url === "string" && url.includes(endpoint);
  });
}

export function mergeClaudeSettings(settings: Settings, ptyWinPort: number): Settings {
  const existingHooks = settings.hooks && typeof settings.hooks === "object" && !Array.isArray(settings.hooks)
    ? settings.hooks as Record<string, unknown>
    : {};
  const nextHooks: Record<string, unknown> = { ...existingHooks };

  for (const event of Object.keys(PTY_WIN_HOOKS)) {
    const entries = Array.isArray(existingHooks[event]) ? existingHooks[event] as unknown[] : [];
    nextHooks[event] = [
      ...entries.filter((entry) => !isPtyWinHookEntry(entry, event)),
      hookEntryFor(event, ptyWinPort),
    ];
  }

  return {
    ...settings,
    hooks: nextHooks,
    messageIdleNotifThresholdMs: 5000,
  };
}

export function writeHooks(workspacesDir: string, ptyWinPort: number): void {
  const dirs = readdirSync(workspacesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory());

  for (const dir of dirs) {
    const claudeDir = join(workspacesDir, dir.name, ".claude");
    mkdirSync(claudeDir, { recursive: true });
    const settingsPath = join(claudeDir, "settings.local.json");
    const settings = mergeClaudeSettings(readSettings(settingsPath), ptyWinPort);
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2), "utf-8");
    console.log(`  Hooks configured: ${dir.name}`);
  }
}
