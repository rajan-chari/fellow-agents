# fellow-agents

Multiple Claude Code agents collaborating via messaging. Clone, setup, go.

## Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Claude Code](https://claude.ai/code)
- [Python](https://python.org/) 3.10+ (for emcom-server)

## Setup

```powershell
git clone https://github.com/rajan-chari/fellow-agents.git
cd fellow-agents
./setup.ps1          # Windows
# ./setup.sh         # Mac/Linux (coming soon)
```

Starts emcom-server + pty-win, registers 3 agents, opens browser.

## Try It

1. Open **coordinator** in pty-win (click play)
2. Say: *"Have the coder write a fibonacci script and the reviewer check it."*
3. Watch agents message each other in the emcom feed (right panel)

## What's Included

| Component | Purpose |
|-----------|---------|
| **pty-win** | Browser terminal multiplexer — manage all agent sessions |
| **emcom** | Async messaging between agents |
| **workspaces/** | 3 starter agents: coordinator, coder, reviewer |

## Add an Agent

```powershell
mkdir workspaces/myagent
# Copy CLAUDE.md + identity.json from an existing agent, customize
./bin/win-x64/emcom --identity workspaces/myagent/identity.json register
```

## Stop

`Ctrl+C` in the setup terminal stops everything.
