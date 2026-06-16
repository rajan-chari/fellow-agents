import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import test from "node:test";

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
