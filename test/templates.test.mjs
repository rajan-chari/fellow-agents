import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const roles = ["coder", "coordinator", "reviewer"];

test("agent templates guard emcom startup commands when emcom is missing from PATH", () => {
  for (const role of roles) {
    const template = readFileSync(join(process.cwd(), "templates", role, "CLAUDE.md"), "utf-8");
    assert.match(template, /command -v emcom >\/dev\/null 2>&1; then emcom register/);
    assert.match(template, /emcom not found; skipping registration/);
    assert.match(template, /command -v emcom >\/dev\/null 2>&1; then emcom inbox/);
    assert.match(template, /emcom not found; skipping inbox check/);
  }
});
