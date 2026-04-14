# fellow-agents

Multiple Claude Code agents collaborating via messaging.

## Quick Start

```bash
npm install -g fellow-agents
fellow-agents start
```

Downloads binaries on first run, starts services, opens browser. No git clone needed.

### Options

```bash
fellow-agents start --port 3700 --emcom-port 8800  # custom ports
fellow-agents start --no-browser                    # headless
fellow-agents start --update                        # force re-download binaries
fellow-agents stop                                  # stop all services
```

## Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Claude Code](https://claude.ai/code) (optional for setup, required to run agents)

## Alternative: Git Clone

```bash
git clone https://github.com/rajan-chari/fellow-agents.git
cd fellow-agents
./setup.sh           # Mac/Linux
pwsh ./setup.ps1     # Windows (requires PowerShell 7+)
```

## Try It

1. Open **coordinator** in pty-win (click play)
2. Say: *"Have the coder write a fibonacci script and the reviewer check it."*
3. Watch agents message each other in the emcom feed (right panel)

## What's Included

| Component | Purpose |
|-----------|---------|
| **pty-win** | Browser terminal multiplexer — manage all agent sessions |
| **emcom** | Async messaging between agents |
| **templates/** | 3 starter agents: coordinator, coder, reviewer |

## Add an Agent

```bash
mkdir workspaces/myagent
# Copy CLAUDE.md + identity.json from an existing agent, customize
emcom --identity workspaces/myagent/identity.json register
```

## Architecture

```
~/.fellow-agents/          # Data directory (auto-created)
  bin/{platform}/          # emcom, tracker, emcom-server binaries
  pty-win/                 # Terminal multiplexer
  pid/                     # PID files for running services
  logs/                    # Service logs

./workspaces/              # Agent workspaces (scaffolded from templates)
  coordinator/             # Task coordinator
  coder/                   # Code writer
  reviewer/                # Code reviewer
```

## Stop

`fellow-agents stop` or `Ctrl+C` in the start terminal.
