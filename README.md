# fellow-agents

Multi-agent Claude Code. Clone, run, collaborate.

## Quick Start

```powershell
git clone https://github.com/rajan-chari/fellow-agents.git
cd fellow-agents
./start.ps1
```

Opens browser at `:3700`. Three agents ready: **coordinator**, **coder**, **reviewer**.

Click ▶ on **coordinator** and say: *"Have the coder write a fibonacci script and the reviewer check it."*

Watch the emcom feed panel (right sidebar) — agents messaging each other.

`Ctrl+C` stops everything.

## Prerequisites

Node.js 18+, Claude Code, Windows + PowerShell 7+

## Add an Agent

Copy an existing workspace folder, edit CLAUDE.md + identity.json, register:

```powershell
./bin/emcom --identity workspaces/myagent/identity.json register
```
