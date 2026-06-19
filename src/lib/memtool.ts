import { spawnSync } from "child_process";
import { randomUUID } from "crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "fs";
import { basename, dirname, join, resolve } from "path";

export const MEMORY_SCHEMA = 1;

export const STORES = ["working-log", "field-note"] as const;
export type MemoryStore = (typeof STORES)[number];

export const SCOPES = ["agent-local", "private-user", "team-proposed"] as const;
export type MemoryScope = (typeof SCOPES)[number];

export const SENSITIVITIES = [
  "team-public",
  "internal",
  "agent-private",
  "user-private",
  "sensitive-restricted",
  "unknown-needs-review",
] as const;
export type Sensitivity = (typeof SENSITIVITIES)[number];

export const LIFECYCLES = ["draft", "requested", "needs-info", "accepted", "rejected", "superseded", "stale"] as const;
export type MemoryLifecycle = (typeof LIFECYCLES)[number];

export interface MemoryLink {
  type: "tracker" | "emcom" | "thread" | "commit" | "file" | "wiki";
  target: string;
}

export interface MemoryRecord {
  schema: number;
  id: string;
  record_type: MemoryStore;
  store: MemoryStore;
  owner_agent: string;
  owner_user?: string;
  scope: MemoryScope;
  sensitivity: Sensitivity;
  subject: string;
  body: string;
  source_citations: string[];
  created_at: string;
  updated_at: string;
  review_after?: string;
  stale_after?: string;
  links: MemoryLink[];
  lifecycle: MemoryLifecycle;
  promotion_target?: string;
  promotion_request_id?: string;
  supersedes?: string;
  superseded_by?: string;
}

export interface SaveOptions {
  root: string;
  store: MemoryStore;
  subject: string;
  body: string;
  sources: string[];
  scope?: MemoryScope;
  sensitivity?: Sensitivity;
  ownerAgent?: string;
  ownerUser?: string;
  reviewAfter?: string;
  staleAfter?: string;
  now?: Date;
}

export interface QueryOptions {
  root: string;
  terms?: string[];
  store?: MemoryStore;
  scope?: MemoryScope | "all";
  includeStale?: boolean;
  now?: Date;
}

export interface PromoteRequestOptions {
  root: string;
  id: string;
  to: string;
  reviewer?: string;
  destination: string;
  rationale: string;
  dryRun?: boolean;
  now?: Date;
}

export function resolveMemoryRoot(input?: string): string {
  if (input) return resolve(input);
  const cwd = process.cwd();
  const identity = readIdentity(cwd);
  if (identity?.name) {
    const candidate = resolve(cwd, "..", "working-state", identity.name);
    if (existsSync(candidate)) return candidate;
  }
  return cwd;
}

export function memoryDir(root: string): string {
  return join(root, "memory");
}

export function defaultOwner(root: string): string {
  const identity = readIdentity(process.cwd());
  if (identity?.name) return identity.name;
  return basename(resolve(root));
}

export function saveRecord(opts: SaveOptions): MemoryRecord {
  assertAllowed(STORES, opts.store, "store");
  if (opts.sources.length === 0) {
    throw new Error("save requires at least one --source citation");
  }
  const scope = opts.scope ?? "agent-local";
  const sensitivity = opts.sensitivity ?? "agent-private";
  assertAllowed(SCOPES, scope, "scope");
  assertAllowed(SENSITIVITIES, sensitivity, "sensitivity");
  assertDate(opts.reviewAfter, "review-after");
  assertDate(opts.staleAfter, "stale-after");
  assertNoSecretContent([opts.subject, opts.body, ...opts.sources], sensitivity);

  const now = (opts.now ?? new Date()).toISOString();
  const id = newId(opts.store, opts.subject, opts.now ?? new Date());
  const record: MemoryRecord = {
    schema: MEMORY_SCHEMA,
    id,
    record_type: opts.store,
    store: opts.store,
    owner_agent: opts.ownerAgent ?? defaultOwner(opts.root),
    owner_user: opts.ownerUser,
    scope,
    sensitivity,
    subject: opts.subject,
    body: opts.body,
    source_citations: opts.sources,
    created_at: now,
    updated_at: now,
    review_after: opts.reviewAfter,
    stale_after: opts.staleAfter,
    links: [],
    lifecycle: "draft",
  };
  writeRecord(opts.root, record);
  return record;
}

export function listRecords(opts: QueryOptions): MemoryRecord[] {
  const records = readAllRecords(opts.root);
  return filterRecords(records, opts);
}

export function queryRecords(opts: QueryOptions): MemoryRecord[] {
  const terms = (opts.terms ?? []).map((term) => term.toLowerCase()).filter(Boolean);
  return listRecords(opts).filter((record) => {
    if (terms.length === 0) return true;
    const haystack = [
      record.id,
      record.subject,
      record.body,
      record.store,
      record.scope,
      record.sensitivity,
      record.lifecycle,
      ...record.source_citations,
      ...record.links.map((link) => `${link.type}:${link.target}`),
    ].join("\n").toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

export function linkRecord(root: string, id: string, links: MemoryLink[]): MemoryRecord {
  if (links.length === 0) {
    throw new Error("link requires at least one link flag");
  }
  const record = readRecord(root, id);
  const now = new Date().toISOString();
  const existing = new Set(record.links.map((link) => `${link.type}:${link.target}`));
  for (const link of links) {
    if (!link.target.trim()) throw new Error(`${link.type} link target cannot be empty`);
    const key = `${link.type}:${link.target}`;
    if (!existing.has(key)) {
      record.links.push(link);
      existing.add(key);
    }
  }
  record.updated_at = now;
  writeRecord(root, record);
  return record;
}

export function promoteRequest(opts: PromoteRequestOptions): { record: MemoryRecord; message: string; sent: boolean; requestId?: string } {
  const record = readRecord(opts.root, opts.id);
  if (isStale(record, opts.now)) {
    throw new Error("stale records cannot be promoted until reverified");
  }
  if (record.sensitivity === "sensitive-restricted" || record.sensitivity === "unknown-needs-review") {
    throw new Error(`${record.sensitivity} records must be reviewed/reclassified before promotion`);
  }
  if (opts.to === "team-wiki" && (record.scope !== "team-proposed" || (record.sensitivity !== "team-public" && record.sensitivity !== "internal"))) {
    throw new Error("team-wiki promotion requires scope=team-proposed and sensitivity=team-public or internal");
  }
  if (record.source_citations.length === 0) {
    throw new Error("promotion requires exact source citations");
  }

  if (record.sensitivity === "user-private" && opts.reviewer && opts.reviewer !== "private-librarian") {
    throw new Error("user-private records can only be routed to private-librarian");
  }
  const reviewer = opts.reviewer ?? (record.sensitivity === "user-private" ? "private-librarian" : "librarian");
  const message = formatPromotionMessage(record, opts.to, opts.destination, opts.rationale);
  let sent = false;
  let requestId: string | undefined;
  if (!opts.dryRun) {
    const result = spawnSync("emcom", [
      "send",
      "--to",
      reviewer,
      "--subject",
      `Memory promotion request: ${record.subject}`,
      "--body",
      message,
    ], { encoding: "utf-8" });
    if (result.status !== 0) {
      throw new Error(`emcom send failed: ${(result.stderr || result.stdout).trim()}`);
    }
    sent = true;
    requestId = parseSentId(result.stdout);
  }

  record.lifecycle = "requested";
  record.promotion_target = opts.to;
  record.promotion_request_id = requestId
    ?? `${sent ? "sent:unparsed" : "dry-run"}:${newId("working-log", "promotion", opts.now ?? new Date())}`;
  record.updated_at = (opts.now ?? new Date()).toISOString();
  writeRecord(opts.root, record);

  return { record, message, sent, requestId };
}

export function formatRecordLine(record: MemoryRecord, now = new Date()): string {
  const privateSensitivity = record.sensitivity === "agent-private"
    || record.sensitivity === "user-private"
    || record.sensitivity === "sensitive-restricted"
    || record.sensitivity === "unknown-needs-review";
  const markers = [
    record.scope !== "team-proposed" || privateSensitivity ? "PRIVATE" : "TEAM-PROPOSED",
    isStale(record, now) ? "STALE" : "FRESH",
    record.lifecycle.toUpperCase(),
  ].join(",");
  const citations = record.source_citations.join("; ");
  return [
    record.id,
    `store=${record.store}`,
    `owner=${record.owner_agent}${record.owner_user ? `/user:${record.owner_user}` : ""}`,
    `scope=${record.scope}`,
    `sensitivity=${record.sensitivity}`,
    `markers=${markers}`,
    `curation=${record.lifecycle === "accepted" ? "curated" : "draft/proposed"}`,
    `citation=${citations}`,
    `subject=${record.subject}`,
  ].join(" | ");
}

export function isStale(record: MemoryRecord, now = new Date()): boolean {
  if (record.lifecycle === "stale") return true;
  if (!record.stale_after && !record.review_after) return false;
  const threshold = record.stale_after ?? record.review_after;
  return threshold ? Date.parse(threshold) <= now.getTime() : false;
}

function filterRecords(records: MemoryRecord[], opts: QueryOptions): MemoryRecord[] {
  return records
    .filter((record) => !opts.store || record.store === opts.store)
    .filter((record) => !opts.scope || opts.scope === "all" || record.scope === opts.scope)
    .filter((record) => opts.includeStale || !isStale(record, opts.now))
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

function readAllRecords(root: string): MemoryRecord[] {
  const base = memoryDir(root);
  if (!existsSync(base)) return [];
  const records: MemoryRecord[] = [];
  for (const store of STORES) {
    const dir = join(base, store);
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      records.push(parseRecord(join(dir, entry.name)));
    }
  }
  return records;
}

function readRecord(root: string, id: string): MemoryRecord {
  const matches = readAllRecords(root).filter((record) => record.id === id || record.id.startsWith(id));
  if (matches.length === 0) throw new Error(`memory record not found: ${id}`);
  if (matches.length > 1) throw new Error(`memory record prefix is ambiguous: ${id}`);
  return matches[0];
}

function parseRecord(path: string): MemoryRecord {
  const parsed = JSON.parse(readFileSync(path, "utf-8"));
  if (!parsed || typeof parsed !== "object") throw new Error(`${path} is not a memory record`);
  const record = parsed as MemoryRecord;
  if (record.schema !== MEMORY_SCHEMA) throw new Error(`${path} has unsupported schema ${record.schema}`);
  assertAllowed(STORES, record.store, "store");
  assertAllowed(SCOPES, record.scope, "scope");
  assertAllowed(SENSITIVITIES, record.sensitivity, "sensitivity");
  assertAllowed(LIFECYCLES, record.lifecycle, "lifecycle");
  return record;
}

function writeRecord(root: string, record: MemoryRecord): void {
  const dir = join(memoryDir(root), record.store);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${record.id}.json`);
  const tmp = `${path}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(record, null, 2) + "\n", "utf-8");
    renameSync(tmp, path);
  } catch (err) {
    try {
      if (existsSync(tmp)) unlinkSync(tmp);
    } catch {}
    throw err;
  }
}

function newId(store: MemoryStore, subject: string, now: Date): string {
  const date = now.toISOString().slice(0, 10).replace(/-/g, "");
  const slug = subject.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || store;
  return `${date}-${slug}-${randomUUID().slice(0, 8)}`;
}

function assertAllowed<T extends readonly string[]>(allowed: T, value: string, label: string): asserts value is T[number] {
  if (!allowed.includes(value)) {
    throw new Error(`invalid ${label} '${value}'. Valid values: ${allowed.join(", ")}`);
  }
}

function assertNoSecretContent(values: string[], sensitivity: Sensitivity): void {
  if (sensitivity === "sensitive-restricted") {
    throw new Error("sensitive-restricted records are hard-blocked; route secrets/credentials to private-librarian guidance instead");
  }
  const secretPattern = /\b(secret|credential|password|token|api[_-]?key|private[_-]?key)\b/i;
  if (values.some((value) => secretPattern.test(value))) {
    throw new Error("possible secret/credential content detected; do not save it with memtool, route to private-librarian guidance instead");
  }
}

function assertDate(value: string | undefined, label: string): void {
  if (!value) return;
  if (Number.isNaN(Date.parse(value))) {
    throw new Error(`invalid ${label} date '${value}'; use an ISO-8601 timestamp or date`);
  }
}

function readIdentity(dir: string): { name?: string } | null {
  const path = join(dir, "identity.json");
  if (!existsSync(path)) return null;
  const parsed = JSON.parse(readFileSync(path, "utf-8"));
  return parsed && typeof parsed === "object" ? parsed as { name?: string } : null;
}

function formatPromotionMessage(record: MemoryRecord, target: string, destination: string, rationale: string): string {
  return [
    `Please review this memtool promotion request.`,
    ``,
    `Record: ${record.id}`,
    `Subject: ${record.subject}`,
    `Store: ${record.store}`,
    `Owner: ${record.owner_agent}${record.owner_user ? `/user:${record.owner_user}` : ""}`,
    `Scope: ${record.scope}`,
    `Sensitivity: ${record.sensitivity}`,
    `Target: ${target}`,
    `Proposed destination: ${destination}`,
    `Durability rationale: ${rationale}`,
    `Review/stale date: ${record.stale_after ?? record.review_after ?? "(none)"}`,
    `Citations:`,
    ...record.source_citations.map((citation) => `- ${citation}`),
    `Links:`,
    ...(record.links.length > 0 ? record.links.map((link) => `- ${link.type}:${link.target}`) : ["- (none)"]),
    ``,
    record.body,
  ].join("\n");
}

function parseSentId(stdout: string): string | undefined {
  const match = stdout.match(/\[([0-9a-f-]{8,})\]/i);
  return match?.[1];
}
