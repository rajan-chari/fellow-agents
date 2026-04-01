# fellow-agents

Multi-agent Claude Code starter kit. Clone, run, collaborate.

## Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Claude Code](https://claude.ai/code)
- Windows + PowerShell 7+

## Start

```powershell
git clone https://github.com/rajan-chari/fellow-agents.git
cd fellow-agents
./start.ps1        # starts emcom-server (:8800) + pty-win (:3700), opens browser
```

`Ctrl+C` to stop everything.

## Agents

| Agent | Role |
|-------|------|
| **coordinator** | Delegates tasks, collects results |
| **coder** | Writes and fixes code |
| **reviewer** | Reviews code for quality |

Each has a `CLAUDE.md` (instructions) and `identity.json` (emcom identity) in `workspaces/`.

## Try It

1. Open **coordinator** (click ▶ in pty-win)
2. Say: *"Have the coder write a fibonacci script and the reviewer check it."*
3. Watch the emcom feed panel (right sidebar)

## Add an Agent

```powershell
mkdir workspaces/myagent
# Add CLAUDE.md and identity.json (copy from an existing agent)
./bin/emcom --identity workspaces/myagent/identity.json register
```
