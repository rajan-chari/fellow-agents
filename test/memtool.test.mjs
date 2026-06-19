import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  formatRecordLine,
  linkRecord,
  listRecords,
  promoteRequest,
  queryRecords,
  saveRecord,
} from "../dist/lib/memtool.js";

const cli = join(process.cwd(), "dist", "memtool.js");

function tempRoot() {
  const root = mkdtempSync(join(tmpdir(), "memtool-"));
  mkdirSync(root, { recursive: true });
  return root;
}

function run(args) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: process.cwd(),
    encoding: "utf-8",
  });
}

test("save defaults to narrow agent-local private records with citations", () => {
  const root = tempRoot();
  const record = saveRecord({
    root,
    store: "field-note",
    subject: "Retry submits only visible injected text",
    body: "If injected prompt text is still visible, retry submit-only.",
    sources: ["field-notes.md:16-18"],
    ownerAgent: "forge",
    now: new Date("2026-06-19T03:00:00Z"),
  });

  assert.equal(record.scope, "agent-local");
  assert.equal(record.sensitivity, "agent-private");
  assert.equal(record.lifecycle, "draft");
  assert.deepEqual(record.source_citations, ["field-notes.md:16-18"]);

  const stored = JSON.parse(readFileSync(join(root, "memory", "field-note", `${record.id}.json`), "utf-8"));
  assert.equal(stored.schema, 1);
  assert.equal(stored.subject, record.subject);
});

test("query output exposes store owner scope sensitivity citation stale and curation markers", () => {
  const root = tempRoot();
  const record = saveRecord({
    root,
    store: "working-log",
    subject: "Release checkpoint",
    body: "v0.0.40 GitHub release verified.",
    sources: ["tracker 9b4a3c22"],
    ownerAgent: "forge",
    staleAfter: "2026-06-18T00:00:00.000Z",
    now: new Date("2026-06-17T00:00:00Z"),
  });

  assert.equal(queryRecords({ root, terms: ["release"], now: new Date("2026-06-19T00:00:00Z") }).length, 0);

  const [match] = queryRecords({
    root,
    terms: ["release"],
    includeStale: true,
    now: new Date("2026-06-19T00:00:00Z"),
  });
  const line = formatRecordLine(match, new Date("2026-06-19T00:00:00Z"));

  assert.equal(match.id, record.id);
  assert.match(line, /store=working-log/);
  assert.match(line, /owner=forge/);
  assert.match(line, /scope=agent-local/);
  assert.match(line, /sensitivity=agent-private/);
  assert.match(line, /markers=PRIVATE,STALE,DRAFT/);
  assert.match(line, /curation=draft\/proposed/);
  assert.match(line, /citation=tracker 9b4a3c22/);
});

test("link adds explicit tracker and emcom references without duplicates", () => {
  const root = tempRoot();
  const record = saveRecord({
    root,
    store: "working-log",
    subject: "Memory design handoff",
    body: "Design moved to implementation.",
    sources: ["tracker 42b11a66"],
    ownerAgent: "forge",
  });

  linkRecord(root, record.id, [
    { type: "tracker", target: "2a6635ff" },
    { type: "emcom", target: "b08b2503" },
    { type: "tracker", target: "2a6635ff" },
  ]);

  const [updated] = listRecords({ root, includeStale: true });
  assert.deepEqual(updated.links, [
    { type: "tracker", target: "2a6635ff" },
    { type: "emcom", target: "b08b2503" },
  ]);
});

test("promote-request dry-run creates librarian packet and never writes wiki directly", () => {
  const root = tempRoot();
  const record = saveRecord({
    root,
    store: "field-note",
    subject: "Build provenance should be baked",
    body: "Runtime git detection fails in shipped artifacts.",
    sources: ["field-notes.md:19-20"],
    scope: "team-proposed",
    sensitivity: "internal",
    ownerAgent: "forge",
    staleAfter: "2026-12-31T00:00:00.000Z",
    now: new Date("2026-06-19T03:00:00Z"),
  });

  const result = promoteRequest({
    root,
    id: record.id,
    to: "team-wiki",
    destination: "tooling/fellow-agents/releases.md",
    rationale: "Repeated release gotcha useful to all agents.",
    dryRun: true,
    now: new Date("2026-06-19T03:01:00Z"),
  });

  assert.equal(result.sent, false);
  assert.equal(result.record.lifecycle, "requested");
  assert.match(result.message, /Proposed destination: tooling\/fellow-agents\/releases.md/);
  assert.match(result.message, /Durability rationale: Repeated release gotcha useful to all agents\./);
  assert.match(result.message, /- field-notes.md:19-20/);
  assert.match(result.record.promotion_request_id, /^dry-run:/);
});

test("promote-request enforces team scope and private-user routing", () => {
  const root = tempRoot();
  const privateRecord = saveRecord({
    root,
    store: "field-note",
    subject: "Local-only gotcha",
    body: "Keep this local until reviewed.",
    sources: ["briefing.md:10"],
    ownerAgent: "forge",
  });

  assert.throws(() => promoteRequest({
    root,
    id: privateRecord.id,
    to: "team-wiki",
    destination: "tooling/fellow-agents/setup.md",
    rationale: "Useful later.",
    dryRun: true,
  }), /team-wiki promotion requires scope=team-proposed/);

  const userPrivate = saveRecord({
    root,
    store: "field-note",
    subject: "Private user preference",
    body: "Route only to the private curator.",
    sources: ["private note"],
    scope: "private-user",
    sensitivity: "user-private",
    ownerAgent: "wren",
    ownerUser: "Rajan",
  });

  assert.throws(() => promoteRequest({
    root,
    id: userPrivate.id,
    to: "private-wiki",
    reviewer: "librarian",
    destination: "private/preferences.md",
    rationale: "Private user context.",
    dryRun: true,
  }), /user-private records can only be routed to private-librarian/);
});

test("promote-request rejects unknown targets instead of bypassing team-wiki gates", () => {
  const root = tempRoot();
  const record = saveRecord({
    root,
    store: "field-note",
    subject: "Private draft",
    body: "This should not route through a typo target.",
    sources: ["briefing.md:11"],
    ownerAgent: "forge",
  });

  assert.throws(() => promoteRequest({
    root,
    id: record.id,
    to: "wiki",
    destination: "tooling/fellow-agents/setup.md",
    rationale: "Typo should not bypass gates.",
    dryRun: true,
  }), /invalid promotion target 'wiki'/);

  const result = run(["promote-request", record.id, "--dir", root, "--to", "teamwiki", "--destination", "x", "--rationale", "x", "--dry-run"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /invalid promotion target 'teamwiki'/);
});

test("secret-like content and tracker-like status are rejected", () => {
  const root = tempRoot();
  assert.throws(() => saveRecord({
    root,
    store: "working-log",
    subject: "API token",
    body: "token value was seen",
    sources: ["session"],
    ownerAgent: "forge",
  }), /possible secret\/credential content detected/);

  const result = run(["save", "--dir", root, "--store", "working-log", "--subject", "x", "--body", "x", "--source", "x", "--status", "triaged"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /do not have tracker-like --status/);
});

test("source citations must be real values, not missing boolean placeholders", () => {
  const root = tempRoot();

  assert.throws(() => saveRecord({
    root,
    store: "field-note",
    subject: "Missing citation",
    body: "No placeholder citations.",
    sources: ["true"],
    ownerAgent: "forge",
  }), /citations must be real --source values/);

  const result = run(["save", "--dir", root, "--store", "field-note", "--subject", "x", "--body", "x", "--source"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--source requires a value/);
});

test("invalid stale and review dates are rejected instead of silently becoming never stale", () => {
  const root = tempRoot();

  assert.throws(() => saveRecord({
    root,
    store: "working-log",
    subject: "Bad stale date",
    body: "This should fail.",
    sources: ["test"],
    staleAfter: "next-week",
  }), /invalid stale-after date/);

  assert.throws(() => saveRecord({
    root,
    store: "working-log",
    subject: "Bad review date",
    body: "This should fail.",
    sources: ["test"],
    reviewAfter: "2026-13-01",
  }), /invalid review-after date/);
});

test("team-proposed records with private sensitivity keep an obvious private marker", () => {
  const root = tempRoot();
  const record = saveRecord({
    root,
    store: "field-note",
    subject: "Needs private scan",
    body: "This is scoped for proposal but still private.",
    sources: ["test"],
    scope: "team-proposed",
    sensitivity: "user-private",
  });

  assert.match(formatRecordLine(record), /markers=PRIVATE,FRESH,DRAFT/);
});

test("memtool help describes the standalone CLI", () => {
  const result = run(["--help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /memtool — explicit file-backed memory records/);
  assert.match(result.stdout, /promote-request/);
});
