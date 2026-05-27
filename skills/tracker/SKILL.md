---
name: tracker
description: |
  Use this skill when the user wants to interact with the team task tracker,
  or when the agent itself needs to view its own work queue or file/update
  tracker items.
  Triggers: check queue, my work, what's next, file a tracker item,
  open issue, update status, mark merged, close item, decisions pending,
  blocked items, stale items, list bugs, list PRs, work item history,
  link items, or arrival of an emcom auto-inject prompt that references
  tracker work.
tools:
  - Bash
  - Read
  - Write
---

# tracker Skill

The team **tracker** is a cross-session, cross-agent record of in-flight work: bugs, PRs, investigations, and decisions. It is the source of truth for "what work is open right now" — distinct from briefing.md (per-session narrative) and field-notes.md (persistent gotchas).

A tracker item exists when work spans sessions or involves more than one agent. A briefing entry covers what your current self did. A field-note captures a one-shot gotcha you want to remember forever. If you can't answer "is this still in flight" or "who's working on this" by reading just your briefing, the work belongs in tracker.

## Mental model

- **Items** have status, severity, labels, and assignment.
- **Queue** is your slice — `tracker queue` shows items assigned to you, or referenced in ways you should act on.
- **Statuses** drive workflow — items move through a defined lifecycle (see below). The status field is **strictly validated**: generic terms (`in_progress`, `done`, `completed`) are rejected. Use the canonical set.
- **History** is append-only — every status change, decision, and comment is preserved.

## When to file a tracker item

File a tracker item when ANY of:
- The work is likely to span more than one session.
- More than one agent will touch it.
- It needs an owner and a status that other agents will check.
- It's a decision that future-you should be able to find via `tracker decisions`.

Don't file when:
- You're capturing a personal note → use briefing.md or field-notes.md.
- The work completes in this session → just do it and log in briefing.
- It's a coding gotcha you want to remember → field-notes.md.

When in doubt, file. Tracker entries are cheap; missed coordination is expensive.

## Daily flow

```
tracker queue                          # what's assigned to me
tracker view <id>                      # full details + history
tracker update <id> --status <next>    # advance the workflow
tracker comment <id> "<note>"          # add context without status change
```

Reference forms (all accepted):
- UUID prefix (first 8 hex chars work for `view`/`update`)
- `repo#number` (e.g. `banana#42`)
- Bare number when there's no ambiguity

## Status lifecycle

The canonical 11 statuses, in typical workflow order:

| Status | Meaning |
|--------|---------|
| `new` | Just filed; no triage yet |
| `triaged` | Reviewed, has owner + severity, waiting to start |
| `investigating` | Actively working on understanding the problem |
| `findings-reported` | Investigation done, findings documented in --notes |
| `decision-pending` | Needs a call from Rajan or another agent before proceeding |
| `pr-up` | Code change opened as a PR, awaiting review |
| `testing` | PR merged or staged, validating in real env |
| `ready-to-merge` | Reviewed + approved, awaiting merge |
| `merged` | Code is in the target branch |
| `deferred` | Real item, intentionally postponed (`--blocker` should explain) |
| `closed` | Resolved, no further action |

**Critical gotcha**: generic terms like `in_progress`, `done`, `completed`, `wip`, `fixed` are **rejected** by `tracker update --status`. If you mean "actively working on it" use `investigating`. If you mean "code is in" use `merged`. If you mean "fully done" use `closed`.

`tracker list --status open` shows everything non-closed (anything except `merged`, `deferred`, `closed`).

## Filing a new item

```bash
tracker create --repo banana \
  --title "verify-window too tight for Copilot hooks" \
  --type investigation \
  --severity normal \
  --assigned milo \
  --opened-by Rajan \
  --notes "Copilot's PowerShell hook stack takes ~200ms × 3 steps. Current 5s verify often expires."
```

Required: `--repo`, `--title`. Type defaults to `issue`; alternatives are `pr`, `investigation`, `decision`. Severity defaults to `normal`; alternatives `low`, `high`, `critical`. Status defaults to `new`.

`--opened-by` is the person/agent who originally reported the issue (distinct from `--assigned`, which is who works it). Useful when an emcom thread or external party flagged something and you're filing on their behalf.

## Updating an item

```bash
tracker update banana#42 --status investigating --assigned milo --append-notes "Started looking at session.ts verify path."
tracker update <id> --findings "Root cause: ..." --status findings-reported
tracker update <id> --decision "Bump VERIFY_WINDOW_MS to 8s for Copilot only" --decision-rationale "..." --status decision-pending
tracker update <id> --status pr-up --pr 142
```

Notes vs append-notes:
- `--notes <text>` **replaces** the entire notes field.
- `--append-notes <text>` **appends** a timestamped entry. Prefer this.

If something is blocking progress: `--status deferred --blocker "Waiting on upstream node-pty Node 26 prebuilts"`.

## Comments vs notes

- `--append-notes` lives on the item, shown in `view`. Use for substantive findings, status reasoning, links to PRs.
- `tracker comment <id> "<text>"` adds a separate comment record (also shown in history). Use for lightweight chatter that doesn't change the item's state.

## Linking items

```bash
tracker link <id1> <id2> --type related        # default
tracker link <id1> <id2> --type blocks         # id1 blocks id2
tracker link <id1> <id2> --type blocked-by     # id1 blocked by id2
tracker link <id1> <id2> --type duplicate      # id1 duplicates id2
```

Use links instead of restating context across items. Especially `blocks` / `blocked-by` for chains where one decision unblocks several follow-ups.

## Useful queries

| Need | Command |
|------|---------|
| My open items | `tracker queue` |
| Another agent's queue | `tracker queue <agent-name>` |
| Everything not closed | `tracker list --status open` |
| Items needing decision | `tracker list --needs-decision` (alias for `--status decision-pending`) |
| Blocked items | `tracker blocked` |
| Stale items (>24h no update) | `tracker stale` or `tracker stale --hours 48` |
| Decisions made | `tracker decisions` |
| Find by text | `tracker search "<query>"` |
| Item history | `tracker history <id>` |
| Team activity | `tracker report --period 7d` |
| Per-person breakdown | `tracker report people` |
| SLA on open items | `tracker report sla` |
| GitHub-linked activity | `tracker github --period 7d` |
| Summary counts | `tracker stats` |

## Labels and severity

- Labels are freeform comma-separated tags. Use sparingly and consistently — `tracker list --label <name>` finds items by label. Conventional labels: `regression`, `flake`, `infra`, `docs`, `breaking-change`.
- Severity: `low` / `normal` / `high` / `critical`. Default normal. Use `critical` only for production-impacting or blocking-the-team issues.

## Permission-friendly invocation

(Matters in CLIs that gate command execution.)

- **One command per Bash call.** Do NOT chain with `&&`, `;`, or `||`.
- Do NOT assign the binary path to a variable. Use the bare command.
- **Independent** queries (e.g. `queue` + `blocked` + `stale`): parallel Bash calls.
- **Sequential** updates (e.g. create then assign): separate sequential calls.

## Error recovery

**Auth error** ("Missing X-Tracker-Name header"): identical pattern to emcom — register via the team's identity flow. In most workspaces, the `identity.json` registered for emcom also identifies you to tracker, so the fix is usually `cd` to a workspace where you have an identity, not re-registering.

**Connection error** ("Connection refused"): the tracker shares a server with emcom on port 8800. Start it:
```bash
emcom-server &
sleep 2
```
Then retry the tracker command.

**Validation error on status**: you used a generic term. Map to the canonical 11:
- `in_progress`, `working`, `wip` → `investigating`
- `done`, `fixed`, `complete` → either `merged` (code is in) or `closed` (resolved)
- `waiting`, `pending` → either `decision-pending` (waiting on decision) or `deferred` (intentionally postponed)
- `review` → `pr-up` (PR open) or `ready-to-merge` (approved, awaiting merge)

**Missing repo on create**: `--repo` is required. Use the short name from the user's workspace (e.g. `banana`, `fellow-agents`, `pty-cld`).

## Running commands

```bash
tracker <subcommand> [args]
```

`tracker` is on PATH when fellow-agents has been installed (`npm install -g fellow-agents`) — the npm shim wraps `~/.fellow-agents/bin/<platform>/tracker`. Use the bare command. Do not prepend any skills-directory path.

If a CLI environment can't find `tracker` on PATH, that means fellow-agents isn't installed (or its bin shim isn't picked up by the shell). Tell the user to run `npm install -g fellow-agents` rather than guessing at a skill-bundled path — fellow-agents does not ship binaries inside `~/.claude/skills/`, `~/.copilot/skills/`, or `~/.agents/skills/`.

## Output

Tracker output is structured — tables for lists, key/value blocks for `view`, chronological lists for `history`. Present output as-returned; don't reformat. For one item view, show the full structure. For lists, show as-is (already paginated/abbreviated by tracker itself).

## Notes

- Item IDs are UUIDs; first 8 hex chars work as prefix everywhere.
- Server: port 8800 (shared with emcom), data in `~/.emcom/` alongside emcom state.
- Always use `127.0.0.1` rather than `localhost` (avoids IPv6 DNS resolution penalty on Windows).
- `tracker history` shows every state change with timestamp and the agent that made it — useful for "who decided what when".
- Backtick-containing notes via `--notes "..."` get shell-expanded — single-quote when the body contains backticks or `$`.
