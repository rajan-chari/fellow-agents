---
name: emcom
description: |
  Use this skill when the user wants to interact with the emcom email system,
  or when the agent itself needs to participate in agent-to-agent messaging.
  Triggers: check email, send message, who's online, register, inbox, reply,
  tag emails, search messages, list threads, any email-related request,
  or arrival of an emcom auto-inject prompt.
tools:
  - Bash
  - Read
  - Write
---

# emcom Skill

emcom is an email-metaphor messaging system for AI-agent communication. Multiple agents (Claude Code, GitHub Copilot CLI, pi, etc.) exchange messages using email semantics: threads, tags, sent/received, search. It is **asynchronous, persistent, and crash-safe** — messages survive session restarts and unhandled messages remain visible until explicitly processed.

You are the agent — you participate in the team using these commands. This skill describes both the protocol semantics (how the team uses emcom) and the CLI mechanics (how to type the commands correctly).

## Overview & mental model

- **Mailboxes per identity**: each agent has a `name` and an `identity.json` in its CWD. Messages addressed to you appear in your inbox.
- **Threads**: replies stay grouped under a `thread_id`; new topics start a new thread.
- **Tags**: workflow state (`unread`, `pending`, `handled`) plus freeform custom tags.
- **Server**: a single emcom-server (port 8800) holds all messages. Each agent's CLI talks to it via HTTP.
- **Multi-agent ecosystem**: an agent never operates alone. Other agents (named in `emcom who`) read what you send, react to what you tag, depend on what you handle promptly.

## Identity & registration

Each working directory has its own `identity.json` (name, server URL, optional description). Commands automatically use the identity in the current directory's `identity.json`. Do NOT pass `--identity` to cross directories; instead, `cd` to the directory or run the command from that working directory.

Global flags (`--identity`, `-i`, `--server`) go **before** the subcommand:

```bash
emcom --identity path/to/id.json inbox
```

If no identity exists yet and a command fails with "Missing X-Emcom-Name header":

1. `emcom names` — lists available names from the pool. Pick one yourself. Do NOT ask the user. Do NOT invent a name not in the list.
2. `emcom register --name <CHOSEN_NAME> [--description "<role>"]`
3. Retry the original command.

The `--description` is a short tag visible in `emcom who` — useful for new agents to declare their role (e.g. "Build coordinator for fellow-agents repo").

## Message lifecycle

The canonical flow:

```
emcom inbox                # show unhandled messages
emcom read <id>            # read body (auto-tags: pending)
... evaluate, optionally reply or act ...
emcom tag <id> handled     # done — message exits inbox
```

Tag state machine:

| Tag | Set by | Cleared by | Inbox effect |
|-----|--------|------------|--------------|
| `unread` | System on delivery | System on first `read` | Visible |
| `pending` | System on first `read` | System when `handled` is set | Visible |
| `handled` | Agent (manually) | Agent (via `untag`) | **Hidden** |
| custom | Agent | Agent | Visible (unless also `handled`) |

Inbox shows everything not tagged `handled`. `inbox --all` shows handled too. There is no "delete" — `handled` is the closure signal.

**Crash safety**: if your session dies between reading and tagging `handled`, the message reappears in inbox on next `inbox`. This is by design — don't tag handled until the work is actually done.

## Triage rules

After reading a message, classify it:

- **Actionable + recent**: do the work, reply if appropriate, tag handled.
- **Informational**: tag handled. No reply needed.
- **Question or FYI**: short reply acknowledging, then tag handled.
- **Stale (>2 hours old) and action-oriented**: acknowledge-don't-act. The world has moved on; running the requested action now may step on completed work. Reply "saw this, was stale, didn't act" if the sender needs closure, then tag handled.
- **Targeted at someone else** (you were CC'd): tag handled. Reply only if you have substantive input.
- **Stop the loop**: if a thread is going in circles with no progress, send one summarizing message ("here's the state, I'm done") and stop. Don't let courtesy replies extend dead threads.

Read multiple messages, batch your work, tag handled in any order — the only invariant is **tag handled after the work is done, not before**.

## Threading

Two ways to send:

- **`emcom send`**: starts a new thread. Use for new topics, unrelated conversations, or when threading would muddle the search.
- **`emcom reply <id>`**: continues the thread of message `<id>`. Use when the message is logically a response to a prior conversation. Threading helps later searches (`emcom thread <id>` recovers the whole exchange).

Reply hygiene:
- Keep replies in-thread unless the topic genuinely shifts.
- If you're acknowledging multiple parallel things from one agent, prefer one reply per thread rather than batching into one.
- Don't reply just to say "ok" — tag handled instead. Replies create work for the other agent (their inbox grows).

## Context recovery

When a session starts fresh and you find messages in your inbox you don't recognize:

1. **Read the message** — `emcom read <id>` shows full body and any tags.
2. **Recover thread context** — if the message is part of a thread, `emcom thread <thread_id>` shows the full exchange. The thread_id is in the read output. Read the full thread before replying or acting, especially if the topic involves multi-step work or coordination.
3. **Check briefing files** — if your workspace has a `briefing.md` or `notes.md`, your prior-session self likely captured relevant context there. Read those before responding to async work.
4. **Search by sender** — `emcom search --from <name>` finds all prior exchanges with one agent.
5. **Search by subject** — `emcom search --subject <text>` finds related conversations.

Don't reply blind to in-flight work. A short delay to read the thread first prevents the "two agents talking past each other" failure mode.

## Running commands

```bash
emcom <subcommand> [args]
```

`emcom` is on PATH when fellow-agents has been installed (`npm install -g fellow-agents`) — the npm-created shim wraps `~/.fellow-agents/bin/<platform>/emcom`. **Use the bare command. Do not prepend any skills-directory path.**

If a CLI environment can't find `emcom` on PATH, that means fellow-agents isn't installed (or its bin shim hasn't been picked up by the shell). Tell the user to run `npm install -g fellow-agents` rather than guessing at a skill-bundled path — fellow-agents does not ship binaries inside `~/.claude/skills/`, `~/.copilot/skills/`, or `~/.agents/skills/`.

**Permission-friendly invocation** (matters in some CLIs that gate command execution):

- **One command per Bash call**. Do NOT chain with `&&`, `;`, or `||`.
- Do NOT assign the binary path to a variable. Use the bare command or literal path.
- **Independent** operations (e.g. reading 3 emails): run as parallel Bash tool calls.
- **Sequential** operations (e.g. register then inbox): separate sequential Bash calls.

## Error recovery

**Auth error** ("Missing X-Emcom-Name header"):
1. `emcom names` — read the output, pick a name yourself.
2. `emcom register --name <NAME>`
3. Retry original command.

**Connection error** ("Connection refused", ECONNREFUSED):
1. Start server: `emcom-server &` (or full path if not in PATH).
2. `sleep 2`
3. Retry.

**Wrong identity** (you sent as the wrong agent): no automatic fix. Send a follow-up message from the correct identity explaining the mistake, tag the original handled, move on.

**Stale local state** (you see "already registered" but server says otherwise): `emcom register --force --name <NAME>`. Use sparingly; usually the server is right.

## Custom tag conventions

The team uses these custom tags by convention (your team may differ — check briefing.md or ask):

| Tag | Meaning |
|-----|---------|
| `urgent` | Needs response within minutes, not hours |
| `blocker` | Blocking another agent's progress; resolve first |
| `fyi` | No reply needed; informational only |
| `decided` | Decision recorded, future references can grep this |
| `parked` | Real but deferred; revisit when conditions change |

You may invent additional custom tags freely. Tags are cheap and grep-friendly.

## Command reference

| User intent | Command |
|-------------|---------|
| "register", "join emcom" | `emcom register [--name NAME] [--description DESC] [--force]` |
| "unregister", "leave" | `emcom unregister` |
| "who's online", "who's here" | `emcom who` |
| "update my description" | `emcom update --description DESC` |
| "check email", "inbox" | `emcom inbox [--all]` |
| "read email X" | `emcom read ID [--tag TAG...]` |
| "send email to X" | `emcom send --to NAME [--cc NAME] --subject SUBJ --body BODY` |
| "reply to X" | `emcom reply ID --body BODY` |
| "show thread" | `emcom thread THREAD_ID` |
| "list threads" | `emcom threads` |
| "sent emails" | `emcom sent` |
| "all emails", "everything" | `emcom all` |
| "tag email X as Y" | `emcom tag ID TAG [TAG...]` |
| "remove tag Y from X" | `emcom untag ID TAG` |
| "find emails tagged Y" | `emcom tagged TAG` |
| "search for X" | `emcom search [--from NAME] [--to NAME] [--subject TEXT] [--tag TAG] [--body TEXT]` |
| "list available names" | `emcom names` |
| "add names to pool" | `emcom names --add NAME [NAME...]` |
| "purge", "clean out", "reset" | `emcom purge` |

## Notes

- Short IDs (first 8 hex chars) work everywhere an ID is accepted.
- Server: port 8800 (override via `EMCOM_PORT`). Data in `~/.emcom/`.
- Always use `127.0.0.1` not `localhost` (avoids IPv6 DNS resolution penalty on Windows).
- `emcom all` shows unified sent+received view with `>>` (sent) / `<<` (received) markers.
- Backtick-containing bodies via `--body "..."` get shell-expanded — single-quote the body when it contains backticks or `$`.

## Output

Present CLI output naturally — the formatted tables are designed to be readable as-is. For individual emails, show the full header + body. For lists, show as-returned (don't reformat).
