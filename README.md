# fellow-agents

A self-contained starter kit for running multiple Claude Code agents that collaborate via messaging. Clone, run one script, and you have a team of AI agents communicating in a browser-based terminal multiplexer.

## Prerequisites

- **Node.js** 18+ — [nodejs.org](https://nodejs.org/)
- **Claude Code** — [claude.ai/code](https://claude.ai/code)
- **Windows** (PowerShell 7+)

## Quick Start

```powershell
git clone https://github.com/rajan-chari/fellow-agents.git
cd fellow-agents
./start.ps1
```

This will:
1. Start the emcom messaging server (port 8800)
2. Register 3 starter agents (coordinator, coder, reviewer)
3. Install pty-win dependencies and start the terminal multiplexer (port 3700)
4. Open your browser to the pty-win dashboard

## What You Get

Three workspace agents, each with its own Claude Code session:

| Agent | Role | Description |
|-------|------|-------------|
| **coordinator** | Task manager | Breaks down goals, delegates to coder/reviewer, reports results |
| **coder** | Developer | Writes and fixes code based on task descriptions |
| **reviewer** | Code reviewer | Reviews code for quality, bugs, and improvements |

Each agent has a `CLAUDE.md` that tells it how to use emcom to communicate with the others.

## What to Try First

1. Open the **coordinator** session in pty-win (click the play button)
2. Tell it: *"Create a Python script that generates fibonacci numbers. Have the coder write it and the reviewer check it."*
3. Watch the agents message each other via the emcom feed panel (right sidebar)

## How It Works

- **pty-win** — Browser-based terminal multiplexer. Each pane runs a Claude Code session.
- **emcom** — Lightweight async messaging system. Agents send/receive messages to coordinate.
- **Workspaces** — Each agent runs in its own directory with a `CLAUDE.md` (instructions) and `identity.json` (emcom registration).

## Project Structure

```
fellow-agents/
├── start.ps1              # One-script startup
├── bin/                   # emcom + emcom-server executables
├── pty-win/               # Terminal multiplexer (pre-built)
│   ├── dist/              # Compiled server
│   ├── public/            # Frontend (HTML/JS/CSS)
│   └── package.json       # Dependencies
└── workspaces/            # Agent workspaces
    ├── coordinator/       # Task delegation agent
    │   ├── CLAUDE.md
    │   └── identity.json
    ├── coder/             # Code writing agent
    │   ├── CLAUDE.md
    │   └── identity.json
    └── reviewer/          # Code review agent
        ├── CLAUDE.md
        └── identity.json
```

## Customization

- **Add more agents** — Create a new directory in `workspaces/` with a `CLAUDE.md` and `identity.json`. Run `./bin/emcom --identity <path>/identity.json register` to register it.
- **Change agent behavior** — Edit the `CLAUDE.md` in any workspace.
- **Change the port** — Edit `$PtyWinPort` in `start.ps1`.

## Stopping

Press `Ctrl+C` in the PowerShell window where `start.ps1` is running. This stops both pty-win and emcom-server.
