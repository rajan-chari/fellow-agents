import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { formatSetupComplete } from "../dist/commands/start.js";

const cli = join(process.cwd(), "dist", "cli.js");

function run(args) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: process.cwd(),
    encoding: "utf-8",
  });
}

test("top-level help prints usage", () => {
  const result = run(["--help"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /fellow-agents — multi-agent system/);
  assert.match(result.stdout, /fellow-agents clean/);
});

test("stop --help prints help without stopping services", () => {
  const result = run(["stop", "--help"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage: fellow-agents stop/);
  assert.doesNotMatch(result.stdout, /Stopping fellow-agents/);
});

test("clean --help prints help without cleaning state", () => {
  const result = run(["clean", "--help"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage: fellow-agents clean/);
  assert.doesNotMatch(result.stdout, /Cleaning fellow-agents state/);
});

test("uninstall --help prints help without running dry-run preview", () => {
  const result = run(["uninstall", "--help"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage: fellow-agents uninstall/);
  assert.doesNotMatch(result.stdout, /fellow-agents uninstall\n\s+=/);
  assert.doesNotMatch(result.stdout, /This is a dry run/);
});

test("config --help remains mutation-safe", () => {
  const result = run(["config", "--help"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /fellow-agents config — read or write user preferences/);
});

test("status --help prints diagnostics help", () => {
  const result = run(["status", "--help"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage: fellow-agents status/);
  assert.match(result.stdout, /read-only diagnostics/);
});

test("doctor is an alias for read-only status diagnostics", () => {
  const result = run(["doctor", "--port", "1", "--emcom-port", "1"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /fellow-agents status/);
  assert.match(result.stdout, /This command is read-only/);
});

test("status warns about same-folder support hazards", () => {
  const root = mkdtempSync(join(tmpdir(), "fellow-agents-status-"));
  const workspaceRoot = join(root, "workspaces");
  const coder = join(workspaceRoot, "coder");
  const reviewer = join(workspaceRoot, "reviewer");
  mkdirSync(join(coder, ".claude"), { recursive: true });
  mkdirSync(reviewer, { recursive: true });
  writeFileSync(join(coder, "identity.json"), JSON.stringify({
    name: "shared",
    server: "http://127.0.0.1:8800",
  }));
  writeFileSync(join(reviewer, "identity.json"), JSON.stringify({
    name: "shared",
    server: "http://127.0.0.1:8800",
  }));
  writeFileSync(join(coder, ".claude", "settings.local.json"), JSON.stringify({
    hooks: {
      Stop: [{ hooks: [{ type: "http", url: "http://127.0.0.1:3700/api/hook/stop" }] }],
      Notification: [{ hooks: [{ type: "http", url: "http://127.0.0.1:3700/api/hook/notify" }] }],
      UserPromptSubmit: [{ hooks: [{ type: "http", url: "http://127.0.0.1:3700/api/hook/prompt-submit" }] }],
    },
  }));

  const result = run(["status", "--dir", root, "--port", "4000", "--emcom-port", "9000"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /\[OK\] service-namespace: PID\/log files under ~\/.fellow-agents are shared/);
  assert.match(result.stdout, /\[WARN\] identity-duplicate:shared: same emcom\/tracker identity appears in: coder, reviewer/);
  assert.match(result.stdout, /\[WARN\] hook-port:coder: .*settings\.local\.json points pty-win hooks at 3700; expected 4000/);
});

test("setup success output includes lifecycle and troubleshooting commands", () => {
  const output = formatSetupComplete({
    browserUrl: "http://127.0.0.1:3700",
    emcomUrl: "http://127.0.0.1:8800",
    workspaceRoot: "C:\\work\\team\\workspaces",
    cliPreference: "copilot",
    logDir: "C:\\Users\\me\\.fellow-agents\\logs",
  });

  assert.match(output, /Browser UI:\s+http:\/\/127\.0\.0\.1:3700/);
  assert.match(output, /emcom API:\s+http:\/\/127\.0\.0\.1:8800/);
  assert.match(output, /Workspace root:\s+C:\\work\\team\\workspaces/);
  assert.match(output, /CLI preference:\s+copilot/);
  assert.match(output, /Logs:\s+C:\\Users\\me\\.fellow-agents\\logs/);
  assert.match(output, /fellow-agents stop/);
  assert.match(output, /fellow-agents clean/);
  assert.match(output, /fellow-agents --update/);
  assert.match(output, /fellow-agents config get cliPreference/);
  assert.match(output, /fellow-agents status/);
});
