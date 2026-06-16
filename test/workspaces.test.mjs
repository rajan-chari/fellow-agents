import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import { mergeClaudeSettings, writeHooks } from "../dist/lib/workspaces.js";

test("mergeClaudeSettings preserves non-owned settings and replaces pty-win hook entries", () => {
  const existing = {
    permissions: { allow: ["Bash(echo safe)"] },
    customSetting: true,
    hooks: {
      Stop: [
        { matcher: "custom", hooks: [{ type: "command", command: "echo stop" }] },
        { matcher: "", hooks: [{ type: "http", url: "http://127.0.0.1:3700/api/hook/stop", timeout: 2 }] },
      ],
      Notification: [
        { matcher: "custom_notify", hooks: [{ type: "command", command: "echo notify" }] },
      ],
      PreToolUse: [
        { matcher: ".*", hooks: [{ type: "command", command: "echo pre" }] },
      ],
    },
    messageIdleNotifThresholdMs: 1234,
  };

  const merged = mergeClaudeSettings(existing, 3658);

  assert.deepEqual(merged.permissions, existing.permissions);
  assert.equal(merged.customSetting, true);
  assert.deepEqual(merged.hooks.PreToolUse, existing.hooks.PreToolUse);
  assert.equal(merged.messageIdleNotifThresholdMs, 5000);

  assert.equal(merged.hooks.Stop.length, 2);
  assert.deepEqual(merged.hooks.Stop[0], existing.hooks.Stop[0]);
  assert.equal(merged.hooks.Stop[1].hooks[0].url, "http://127.0.0.1:3658/api/hook/stop");

  assert.equal(merged.hooks.Notification.length, 2);
  assert.deepEqual(merged.hooks.Notification[0], existing.hooks.Notification[0]);
  assert.equal(merged.hooks.Notification[1].hooks[0].url, "http://127.0.0.1:3658/api/hook/notify");

  assert.equal(merged.hooks.UserPromptSubmit.length, 1);
  assert.equal(merged.hooks.UserPromptSubmit[0].hooks[0].url, "http://127.0.0.1:3658/api/hook/prompt-submit");
});

test("writeHooks is idempotent and preserves existing workspace settings", () => {
  const root = mkdtempSync(join(tmpdir(), "fellow-agents-workspaces-"));
  const workspace = join(root, "coder");
  const claudeDir = join(workspace, ".claude");
  mkdirSync(claudeDir, { recursive: true });
  const settingsPath = join(claudeDir, "settings.local.json");
  writeFileSync(settingsPath, JSON.stringify({
    permissions: { allow: ["Bash(git status)"] },
    hooks: {
      Stop: [
        { matcher: "custom", hooks: [{ type: "command", command: "echo keep" }] },
      ],
    },
  }, null, 2));

  writeHooks(root, 3658);
  writeHooks(root, 3658);

  const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
  assert.deepEqual(settings.permissions, { allow: ["Bash(git status)"] });
  assert.equal(settings.hooks.Stop.length, 2);
  assert.equal(settings.hooks.Stop.filter((entry) => entry.hooks?.[0]?.url?.includes("/api/hook/stop")).length, 1);
  assert.equal(settings.hooks.Notification.length, 1);
  assert.equal(settings.hooks.UserPromptSubmit.length, 1);
});
