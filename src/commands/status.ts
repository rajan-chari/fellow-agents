import { execFileSync } from "child_process";
import { existsSync, readFileSync, readdirSync } from "fs";
import http from "http";
import { join, resolve } from "path";
import { arch, homedir, platform } from "os";
import { fileURLToPath } from "url";
import { binDir, dataDir, logsDir, pidDir, ptyWinDir, versionFile } from "../lib/paths.js";
import { binarySuffix, detectPlatform } from "../lib/platform.js";
import { lookupCli, readPreferences, preferencesFile } from "../lib/preferences.js";

interface StatusOptions {
  port: number;
  emcomPort: number;
  dir: string;
}

interface Check {
  name: string;
  status: "ok" | "warn" | "fail";
  detail: string;
}

function readText(path: string): string | null {
  try {
    return existsSync(path) ? readFileSync(path, "utf-8").trim() : null;
  } catch {
    return null;
  }
}

function readJson(path: string): Record<string, any> | null {
  try {
    if (!existsSync(path)) return null;
    const parsed = JSON.parse(readFileSync(path, "utf-8"));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function readPid(name: string): number | null {
  const raw = readText(join(pidDir, `${name}.pid`));
  if (!raw) return null;
  const pid = parseInt(raw, 10);
  return Number.isNaN(pid) ? null : pid;
}

function pidRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function commandPath(name: string): string | null {
  try {
    const bin = process.platform === "win32" ? "where.exe" : "which";
    const out = execFileSync(bin, [name], { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    return out[0] ?? null;
  } catch {
    return null;
  }
}

function serviceHealth(url: string): Promise<"ok" | "fail"> {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: 1_000 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200 ? "ok" : "fail");
    });
    req.on("timeout", () => {
      req.destroy();
      resolve("fail");
    });
    req.on("error", () => resolve("fail"));
  });
}

function workspaceRoot(inputDir: string): string {
  const base = resolve(inputDir);
  return existsSync(join(base, "workspaces")) ? join(base, "workspaces") : join(base, "fellow-agents", "workspaces");
}

function workspaceIdentityChecks(workspacesDir: string, emcomPort: number): Check[] {
  if (!existsSync(workspacesDir)) {
    return [{ name: "workspaces", status: "warn", detail: `${workspacesDir} not found` }];
  }
  const checks: Check[] = [];
  for (const entry of readdirSync(workspacesDir, { withFileTypes: true }).filter((item) => item.isDirectory())) {
    const identityPath = join(workspacesDir, entry.name, "identity.json");
    const identity = readJson(identityPath);
    if (!identity) {
      checks.push({ name: `identity:${entry.name}`, status: "warn", detail: `${identityPath} missing or invalid` });
      continue;
    }
    const expected = `http://127.0.0.1:${emcomPort}`;
    const status = identity["server"] === expected ? "ok" : "warn";
    checks.push({ name: `identity:${entry.name}`, status, detail: `${identity["name"] ?? "(no name)"} -> ${identity["server"] ?? "(no server)"}` });
  }
  return checks;
}

function hookChecks(workspacesDir: string): Check[] {
  if (!existsSync(workspacesDir)) return [];
  const checks: Check[] = [];
  for (const entry of readdirSync(workspacesDir, { withFileTypes: true }).filter((item) => item.isDirectory())) {
    const settingsPath = join(workspacesDir, entry.name, ".claude", "settings.local.json");
    const settings = readJson(settingsPath);
    const hooks = settings?.["hooks"];
    const hasHooks = hooks && typeof hooks === "object"
      && ["Stop", "Notification", "UserPromptSubmit"].every((name) => Array.isArray((hooks as Record<string, unknown>)[name]));
    checks.push({
      name: `hooks:${entry.name}`,
      status: hasHooks ? "ok" : "warn",
      detail: hasHooks ? "pty-win Claude hooks present" : `${settingsPath} missing pty-win hooks`,
    });
  }
  return checks;
}

function skillChecks(): Check[] {
  const roots = [
    join(homedir(), ".claude", "skills"),
    join(homedir(), ".copilot", "skills"),
    join(homedir(), ".agents", "skills"),
  ].filter(Boolean);
  return roots.map((root) => ({
    name: `skills:${root}`,
    status: existsSync(root) ? "ok" : "warn",
    detail: existsSync(root) ? "skill root exists" : "skill root missing",
  }));
}

function printCheck(check: Check): void {
  const icon = check.status === "ok" ? "OK" : check.status === "warn" ? "WARN" : "FAIL";
  console.log(`  [${icon}] ${check.name}: ${check.detail}`);
}

export async function status(opts: StatusOptions): Promise<void> {
  const pkgPath = fileURLToPath(new URL("../../package.json", import.meta.url));
  const pkg = readJson(pkgPath);
  const ptyBuild = readJson(join(ptyWinDir, "dist", "build-info.json"));
  const prefs = readPreferences();
  const workspacesDir = workspaceRoot(opts.dir);
  const cachedRelease = readText(versionFile);

  console.log("");
  console.log("  fellow-agents status");
  console.log("  ====================");
  console.log("");
  console.log(`  package:        ${pkg?.["version"] ?? "(unknown)"}`);
  console.log(`  platform:       ${detectPlatform()} (${platform()} ${arch()})`);
  console.log(`  node:           ${process.versions.node}`);
  console.log(`  data dir:       ${dataDir}`);
  console.log(`  logs:           ${logsDir}`);
  console.log(`  cached release: ${cachedRelease ?? "(none)"}`);
  console.log(`  pty-win build:  ${ptyBuild ? `v${ptyBuild["version"] ?? "?"}@${ptyBuild["commit"] ?? "unknown"} (${ptyBuild["fellowAgentsRelease"] ?? "dev"})` : "(missing)"}`);
  console.log(`  preferences:    ${existsSync(preferencesFile) ? preferencesFile : "(none)"}`);
  if (prefs?.cliPreference) {
    console.log(`  cliPreference:  ${prefs.cliPreference} (${lookupCli(prefs.cliPreference) ?? "not on PATH"})`);
  } else {
    console.log("  cliPreference:  (unset)");
  }
  console.log(`  workspaces:     ${workspacesDir}`);
  console.log("");

  const emcomHealth = await serviceHealth(`http://127.0.0.1:${opts.emcomPort}/api/health`);
  const ptyHealth = await serviceHealth(`http://127.0.0.1:${opts.port}/`);
  const checks: Check[] = [
    { name: "emcom-server", status: emcomHealth, detail: `http://127.0.0.1:${opts.emcomPort}/api/health pid=${readPid("emcom-server") ?? "unknown"} running=${readPid("emcom-server") ? pidRunning(readPid("emcom-server")!) : "unknown"}` },
    { name: "pty-win", status: ptyHealth, detail: `http://127.0.0.1:${opts.port}/ pid=${readPid("pty-win") ?? "unknown"} running=${readPid("pty-win") ? pidRunning(readPid("pty-win")!) : "unknown"}` },
    ...["emcom", "tracker", "emcom-server"].map((name) => {
      const bin = join(binDir, `${name}${binarySuffix()}`);
      return { name: `binary:${name}`, status: existsSync(bin) ? "ok" as const : "warn" as const, detail: bin };
    }),
    ...["fellow-agents", "emcom", "tracker", "pty-win", "pty-cld"].map((name) => {
      const resolved = commandPath(name);
      return { name: `PATH:${name}`, status: resolved ? "ok" as const : "warn" as const, detail: resolved ?? "not found" };
    }),
    ...workspaceIdentityChecks(workspacesDir, opts.emcomPort),
    ...hookChecks(workspacesDir),
    ...skillChecks(),
  ];

  for (const check of checks) printCheck(check);
  console.log("");
  console.log("  This command is read-only. It does not start, stop, clean, or update services.");
  console.log("");
}
