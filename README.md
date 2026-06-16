# fellow-agents

**Run a team of Claude Code agents that talk to each other.**

One command gives you a coordinator, a coder, and a reviewer — each in their own terminal, communicating through async messaging, managed from a single browser UI.

```bash
npm install -g fellow-agents
mkdir my-team && cd my-team
fellow-agents
```

That's it. Creates a workspace, downloads what it needs, opens your browser — three agents ready to collaborate.

## What you get

![fellow-agents in action — multiple AI sessions talking to each other in one browser tab](https://raw.githubusercontent.com/rajan-chari/fellow-agents/main/docs/screenshot.png)

A team of AI agents working together in one browser. Each session is an autonomous agent — they message each other, coordinate on tasks, and track shared work. All running locally, all visible at once.

- **(1) CLI sessions are agents.** Each one has its own identity, system prompt, and workspace.
- **(2) Bring your own AI.** Claude Code, GitHub Copilot CLI, pi, or any compatible CLI — mix and match per agent.
- **(3) Agents talk to each other.** Built-in async messaging (emcom) lets agents hand off tasks, request reviews, escalate questions — no shared context window, no token limits.
- **(4) Run one or many per tab.** Group agents by team or project. Switch between tabs like browser tabs.
- **(5) Built-in work tracker.** Every agent sees the same queue. File items, assign work, track status across sessions.

If you've ever wished Claude could send a sub-task to another instance and get an answer back while you keep working — this is that.

---

## What happens when you run it

1. Downloads platform binaries (first run only, ~30 seconds)
2. Installs pty-win dependencies
3. Scaffolds `workspaces/` with three agents: **coordinator**, **coder**, **reviewer**
4. Installs bundled skills for supported AI CLIs
5. Starts the messaging server (emcom) on `http://127.0.0.1:8800`
6. Registers agents, configures hooks, and launches pty-win on `http://127.0.0.1:3700`

Each agent is a Claude Code session with its own workspace, personality, and tools. They message each other through emcom — no shared context window, no token limits, real async collaboration.

## Try it

1. Click **coordinator** in the browser UI (hit play)
2. Tell it: *"Have the coder write a fibonacci function and the reviewer check it for edge cases."*
3. Watch the agents coordinate — messages flow in the feed panel on the right

The coordinator breaks down the task, sends it to the coder via emcom, the coder writes the code and sends it to the reviewer, the reviewer sends feedback back. All visible in real time.

## How it works

```
fellow-agents start
       |
       v
  +-----------+     emcom messages     +-----------+
  | coordinator| <------------------> |   coder    |
  +-----------+                        +-----------+
       ^                                    |
       |           emcom messages           |
       +---------------------------------- +
       |                                    v
  +-----------+                        +-----------+
  |  pty-win  |  browser UI on :3700   |  reviewer |
  +-----------+                        +-----------+
       |
  emcom-server on :8800
```

**pty-win** is the browser-based terminal multiplexer — every agent session in one tab. **emcom** is the messaging layer — agents send, receive, and reply to each other asynchronously. Each agent has a `CLAUDE.md` defining its role and an `identity.json` for messaging.

## Prerequisites

- **Node.js 18+** — [nodejs.org](https://nodejs.org/)
- **Claude Code** — [claude.ai/code](https://claude.ai/code) (needed to run agent sessions)

## Options

```bash
fellow-agents                           # start (default command)
fellow-agents --port 4000               # custom pty-win port
fellow-agents --emcom-port 9000         # custom messaging port
fellow-agents --no-browser              # headless (server/CI)
fellow-agents --update                  # force re-download binaries
fellow-agents status                    # read-only diagnostics
fellow-agents doctor                    # alias for status
fellow-agents config get cliPreference  # show preferred CLI for pty-win tabs
fellow-agents config set cliPreference claude
fellow-agents stop                      # stop all services
fellow-agents clean                     # wipe cached binaries/pty-win install; preserve logs/preferences
fellow-agents uninstall                 # dry-run removal preview
fellow-agents uninstall --yes           # remove state/workspaces and fellow-agents-owned skills
```

## Add your own agent

```bash
mkdir workspaces/designer
```

Create `CLAUDE.md` (the agent's system prompt) and `identity.json` (name + description for messaging):

```json
{
  "name": "designer",
  "description": "UI/UX designer — creates interfaces and reviews layouts",
  "server": "http://127.0.0.1:8800"
}
```

```bash
emcom --identity workspaces/designer/identity.json register
```

Restart pty-win and the new agent appears in the UI.

## Alternative install: git clone

```bash
git clone https://github.com/rajan-chari/fellow-agents.git
cd fellow-agents
./setup.sh           # Mac/Linux
pwsh ./setup.ps1     # Windows (PowerShell 7+)
```

Same result, more control. Useful for development or Docker.

## File layout

```
~/.fellow-agents/              # Auto-created data directory
  bin/{platform}/              # emcom, tracker, emcom-server
  pty-win/                     # Terminal multiplexer
  logs/                        # Service logs (check here if something fails)
  pid/                         # PID files
  preferences.json             # User preferences, including cliPreference

./workspaces/                  # Scaffolded from templates on first run
  coordinator/CLAUDE.md        # "Break tasks down, delegate to coder/reviewer"
  coder/CLAUDE.md              # "Write code, send to reviewer for feedback"
  reviewer/CLAUDE.md           # "Review code, report issues back"
```

## Troubleshooting

**Services won't start?** Run `fellow-agents status` to inspect cached versions, service health, PIDs, PATH resolution, workspace identities, hooks, and skill roots. Also check `~/.fellow-agents/logs/emcom-server.log` and `pty-win.log`.

**Port already in use?** Run `fellow-agents stop`, or use `--port` and `--emcom-port` to pick different ports.

**Browser didn't open?** Navigate to `http://127.0.0.1:3700` manually.

**Wrong CLI launches in a tab?** Run `fellow-agents config get cliPreference`, then set it with `fellow-agents config set cliPreference <name-or-path>`.

**Cached binaries look stale?** Run `fellow-agents --update` to force a re-download. If the cache is partial or broken, run `fellow-agents clean`; this preserves logs and preferences but removes cached binaries, pty-win, and PID files.

**Want to remove everything?** Run `fellow-agents uninstall` to preview, then `fellow-agents uninstall --yes` to remove state, scaffolded workspaces, and fellow-agents-owned skill files. To remove the npm package itself, run `npm uninstall -g fellow-agents`.

## License

MIT
