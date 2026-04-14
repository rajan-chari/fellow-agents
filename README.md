# fellow-agents

**Run a team of Claude Code agents that talk to each other.**

One command gives you a coordinator, a coder, and a reviewer — each in their own terminal, communicating through async messaging, managed from a single browser UI.

```bash
npm install -g fellow-agents
mkdir my-team && cd my-team
fellow-agents
```

That's it. Creates a workspace, downloads what it needs, opens your browser — three agents ready to collaborate.

---

## What happens when you run it

1. Downloads platform binaries (first run only, ~30 seconds)
2. Starts the messaging server (emcom)
3. Registers three agents: **coordinator**, **coder**, **reviewer**
4. Launches the browser UI (pty-win) on `http://localhost:3700`

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
fellow-agents stop                      # stop all services
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

./workspaces/                  # Scaffolded from templates on first run
  coordinator/CLAUDE.md        # "Break tasks down, delegate to coder/reviewer"
  coder/CLAUDE.md              # "Write code, send to reviewer for feedback"
  reviewer/CLAUDE.md           # "Review code, report issues back"
```

## Troubleshooting

**Services won't start?** Check `~/.fellow-agents/logs/emcom-server.log` and `pty-win.log`.

**Port already in use?** Use `--port` and `--emcom-port` to pick different ports.

**Browser didn't open?** Navigate to `http://localhost:3700` manually.

**Want to start fresh?** `rm -rf ~/.fellow-agents` and run `fellow-agents start` again.

## License

MIT
