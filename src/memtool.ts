#!/usr/bin/env node

import {
  formatRecordLine,
  linkRecord,
  listRecords,
  promoteRequest,
  PROMOTION_TARGETS,
  queryRecords,
  resolveMemoryRoot,
  saveRecord,
  SCOPES,
  SENSITIVITIES,
  STORES,
  type MemoryLink,
  type PromotionTarget,
  type MemoryScope,
  type MemoryStore,
  type Sensitivity,
} from "./lib/memtool.js";

const args = process.argv.slice(2);

interface ParsedArgs {
  positional: string[];
  flags: Map<string, string[]>;
}

function parseArgs(input: string[]): ParsedArgs {
  const valueRequired = new Set([
    "--source",
    "--store",
    "--subject",
    "--body",
    "--scope",
    "--sensitivity",
    "--owner-agent",
    "--owner-user",
    "--review-after",
    "--stale-after",
    "--dir",
    "--tracker",
    "--emcom",
    "--thread",
    "--commit",
    "--file",
    "--wiki",
    "--to",
    "--reviewer",
    "--destination",
    "--rationale",
  ]);
  const positional: string[] = [];
  const flags = new Map<string, string[]>();
  for (let i = 0; i < input.length; i++) {
    const arg = input[i];
    if (arg.startsWith("--")) {
      if (arg === "--status") {
        throw new Error("memtool records do not have tracker-like --status; use lifecycle created by memtool commands");
      }
      const next = input[i + 1];
      if (!next || next.startsWith("--")) {
        if (valueRequired.has(arg)) {
          throw new Error(`${arg} requires a value`);
        }
        flags.set(arg, [...(flags.get(arg) ?? []), "true"]);
      } else {
        flags.set(arg, [...(flags.get(arg) ?? []), next]);
        i++;
      }
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

function flag(parsed: ParsedArgs, name: string): string | undefined {
  return parsed.flags.get(name)?.at(-1);
}

function flags(parsed: ParsedArgs, name: string): string[] {
  return parsed.flags.get(name) ?? [];
}

function hasFlag(parsed: ParsedArgs, name: string): boolean {
  return parsed.flags.has(name);
}

function required(parsed: ParsedArgs, name: string): string {
  const value = flag(parsed, name);
  if (!value || value === "true") throw new Error(`${name} is required`);
  return value;
}

function parseStore(value: string): MemoryStore {
  if (!STORES.includes(value as MemoryStore)) {
    throw new Error(`invalid store '${value}'. Valid values: ${STORES.join(", ")}`);
  }
  return value as MemoryStore;
}

function parseScope(value: string | undefined): MemoryScope | undefined {
  if (!value) return undefined;
  if (!SCOPES.includes(value as MemoryScope)) {
    throw new Error(`invalid scope '${value}'. Valid values: ${SCOPES.join(", ")}`);
  }
  return value as MemoryScope;
}

function parseSensitivity(value: string | undefined): Sensitivity | undefined {
  if (!value) return undefined;
  if (!SENSITIVITIES.includes(value as Sensitivity)) {
    throw new Error(`invalid sensitivity '${value}'. Valid values: ${SENSITIVITIES.join(", ")}`);
  }
  return value as Sensitivity;
}

function parsePromotionTarget(value: string | undefined): PromotionTarget {
  const target = value ?? "team-wiki";
  if (!PROMOTION_TARGETS.includes(target as PromotionTarget)) {
    throw new Error(`invalid promotion target '${target}'. Valid values: ${PROMOTION_TARGETS.join(", ")}`);
  }
  return target as PromotionTarget;
}

function root(parsed: ParsedArgs): string {
  return resolveMemoryRoot(flag(parsed, "--dir"));
}

function printHelp(): void {
  console.log(`memtool — explicit file-backed memory records for fellow-agents

Usage:
  memtool save --store <working-log|field-note> --subject <text> --body <text> --source <citation> [options]
  memtool list [--store <store>] [--scope <scope>|--all] [--include-stale]
  memtool query <terms...> [--store <store>] [--scope <scope>|--all] [--include-stale]
  memtool link <id> [--tracker <id>] [--emcom <id>] [--thread <id>] [--commit <sha>] [--file <path>] [--wiki <path>]
  memtool promote-request <id> --destination <wiki-path> --rationale <why> [--to team-wiki] [--reviewer librarian] [--dry-run]

Stores:
  working-log, field-note

Defaults:
  --scope agent-local
  --sensitivity agent-private
  --dir current working-state root, or ../working-state/<identity.name> when present

Rules:
  Records are draft/proposed memory, not tracker work items.
  Query/list output includes store, owner, scope, sensitivity/private marker, citations, stale marker, and curation state.
  Secrets/credentials are hard-blocked; route them to private-librarian guidance instead.
  promote-request sends librarian/private-librarian review intake and never writes team-wiki directly.`);
}

async function main(): Promise<void> {
  const command = args[0];
  if (!command || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  const parsed = parseArgs(args.slice(1));
  if (hasFlag(parsed, "--help") || hasFlag(parsed, "-h")) {
    printHelp();
    return;
  }

  if (command === "save") {
    const record = saveRecord({
      root: root(parsed),
      store: parseStore(required(parsed, "--store")),
      subject: required(parsed, "--subject"),
      body: required(parsed, "--body"),
      sources: flags(parsed, "--source"),
      scope: parseScope(flag(parsed, "--scope")),
      sensitivity: parseSensitivity(flag(parsed, "--sensitivity")),
      ownerAgent: flag(parsed, "--owner-agent"),
      ownerUser: flag(parsed, "--owner-user"),
      reviewAfter: flag(parsed, "--review-after"),
      staleAfter: flag(parsed, "--stale-after"),
    });
    console.log(`Saved ${record.id}`);
    console.log(formatRecordLine(record));
    return;
  }

  if (command === "list") {
    const records = listRecords({
      root: root(parsed),
      store: flag(parsed, "--store") ? parseStore(required(parsed, "--store")) : undefined,
      scope: hasFlag(parsed, "--all") ? "all" : parseScope(flag(parsed, "--scope")),
      includeStale: hasFlag(parsed, "--include-stale"),
    });
    for (const record of records) console.log(formatRecordLine(record));
    if (records.length === 0) console.log("No memory records found.");
    return;
  }

  if (command === "query") {
    const records = queryRecords({
      root: root(parsed),
      terms: parsed.positional,
      store: flag(parsed, "--store") ? parseStore(required(parsed, "--store")) : undefined,
      scope: hasFlag(parsed, "--all") ? "all" : parseScope(flag(parsed, "--scope")),
      includeStale: hasFlag(parsed, "--include-stale"),
    });
    for (const record of records) console.log(formatRecordLine(record));
    if (records.length === 0) console.log("No memory records matched.");
    return;
  }

  if (command === "link") {
    const id = parsed.positional[0];
    if (!id) throw new Error("link requires a record id");
    const links: MemoryLink[] = [
      ...flags(parsed, "--tracker").map((target) => ({ type: "tracker" as const, target })),
      ...flags(parsed, "--emcom").map((target) => ({ type: "emcom" as const, target })),
      ...flags(parsed, "--thread").map((target) => ({ type: "thread" as const, target })),
      ...flags(parsed, "--commit").map((target) => ({ type: "commit" as const, target })),
      ...flags(parsed, "--file").map((target) => ({ type: "file" as const, target })),
      ...flags(parsed, "--wiki").map((target) => ({ type: "wiki" as const, target })),
    ];
    const record = linkRecord(root(parsed), id, links);
    console.log(`Linked ${record.id}`);
    console.log(formatRecordLine(record));
    return;
  }

  if (command === "promote-request") {
    const id = parsed.positional[0];
    if (!id) throw new Error("promote-request requires a record id");
    const result = promoteRequest({
      root: root(parsed),
      id,
      to: parsePromotionTarget(flag(parsed, "--to")),
      reviewer: flag(parsed, "--reviewer"),
      destination: required(parsed, "--destination"),
      rationale: required(parsed, "--rationale"),
      dryRun: hasFlag(parsed, "--dry-run"),
    });
    console.log(result.sent ? `Promotion request sent for ${result.record.id}` : `Promotion request dry-run for ${result.record.id}`);
    console.log(result.message);
    return;
  }

  throw new Error(`unknown command '${command}'`);
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`memtool: ${message}`);
  process.exit(1);
});
