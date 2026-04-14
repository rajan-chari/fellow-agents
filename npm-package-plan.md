# Plan: fellow-agents npm package

## Context
Currently fellow-agents requires `git clone` + `setup.sh`. We want end users to run:
```
npm install -g fellow-agents
fellow-agents start
```
No git clone, no sudo, no manual binary management. Binaries download on first run from GitHub Releases (same source as today).

## Architecture

**Data directory:** `~/.fellow-agents/` stores downloaded binaries, pty-win, PID files — separate from the npm package install location.

**PATH trick:** The CLI prepends `~/.fellow-agents/bin/{platform}` to `process.env.PATH` before spawning pty-win. Since pty-win passes `env: process.env` to agent shell sessions, all agents find emcom/tracker in PATH. No sudo, no system PATH changes.

**Zero runtime npm deps:** CLI uses only Node.js built-ins (fs, path, child_process, https, os). Keeps the package light and avoids dependency issues.

## Package structure

```
fellow-agents/
  package.json              # bin: { "fellow-agents": "dist/cli.js" }, files: ["dist/", "templates/"]
  tsconfig.json             # ESM, target ES2022, outDir: dist
  src/
    cli.ts                  # Entry point — parse args, dispatch to commands
    commands/
      start.ts              # Download binaries, start services, open browser
      stop.ts               # Read PIDs, kill processes
    lib/
      platform.ts           # Detect os+arch → win-x64 | osx-arm64 | osx-x64 | linux-x64
      paths.ts              # Resolve ~/.fellow-agents/, bin dir, templates dir
      download.ts           # Fetch GitHub Releases API, download+extract zips, track version
      services.ts           # Spawn/kill emcom-server + pty-win, PID file management
      workspaces.ts         # Copy templates, register agents via emcom CLI, write hooks
  templates/                # Renamed from workspaces/ — ships in npm package
    coordinator/            # CLAUDE.md + identity.json
    coder/
    reviewer/
```

Not shipped in npm: `setup.sh`, `setup.ps1`, `Dockerfile*`, `.github/`, `src/`, `pty-win/`, `bin/`

## Commands

### `fellow-agents start`
Replaces setup.sh in pure JS. Steps:
1. Check prerequisites (Node 18+ already true, warn if Claude Code missing)
2. Download binaries from GitHub Releases if missing or outdated (`~/.fellow-agents/bin/`)
3. Download + npm install pty-win (`~/.fellow-agents/pty-win/`)
4. Scaffold workspaces in CWD if not present (copy from templates/)
5. Set `process.env.PATH` to include bin dir
6. Start emcom-server (detached, write PID file)
7. Register agents via emcom CLI
8. Write Claude Code hooks to each workspace
9. Start pty-win (detached, write PID file)
10. Open browser, wait for Ctrl+C, cleanup

Flags: `--port`, `--emcom-port`, `--dir <path>`, `--no-browser`, `--update`

### `fellow-agents stop`
Read PID files from `~/.fellow-agents/pid/`, kill processes, remove PID files.

## Key files to modify/create

| File | Action | Notes |
|------|--------|-------|
| `package.json` | Create | bin entry, files array, build script |
| `tsconfig.json` | Create | ESM, strict, outDir: dist |
| `src/cli.ts` | Create | ~30 lines, arg parser + dispatch |
| `src/commands/start.ts` | Create | ~150 lines, port of setup.sh logic |
| `src/commands/stop.ts` | Create | ~30 lines, PID-based kill |
| `src/lib/platform.ts` | Create | ~20 lines |
| `src/lib/paths.ts` | Create | ~25 lines |
| `src/lib/download.ts` | Create | ~80 lines, GitHub API + zip extract |
| `src/lib/services.ts` | Create | ~60 lines, spawn + PID management |
| `src/lib/workspaces.ts` | Create | ~50 lines, copy + register + hooks |
| `workspaces/` → `templates/` | Rename | Update setup.sh/ps1 references |
| `.github/workflows/release.yml` | Edit | Add npm-publish job |
| `.gitignore` | Edit | Add `dist/` |
| `README.md` | Edit | New install instructions |
| `setup.sh` | Edit | Update workspaces/ → templates/ reference |

## Binary download strategy

**First-run download** (not postinstall). Reasons:
- postinstall is fragile (CI, proxies, restricted networks)
- First-run gives clear progress output and retry-friendly errors
- Matches puppeteer/esbuild pattern

Uses `tar -xf` for zip extraction (works on Windows 10+, macOS, Linux — no npm deps needed).

## Release pipeline change

Add `npm-publish` job to release.yml after existing `release` job:
- Checkout → setup-node with registry-url → npm build → set version from tag → npm publish
- Requires `NPM_TOKEN` secret in repo settings

## Verification

1. `npm run build` compiles without errors
2. `npm pack` produces package with only dist/ + templates/ + package.json + README
3. Install globally from local tarball: `npm install -g ./fellow-agents-0.1.0.tgz`
4. `fellow-agents start` in an empty directory: downloads binaries, starts services, opens browser
5. `fellow-agents stop` cleanly kills services
6. Docker test: `npm install -g fellow-agents && fellow-agents start --no-browser` inside container
7. Verify agents can find emcom in PATH (start a Claude Code session, run `which emcom`)

## Transition

Keep setup.sh/setup.ps1 working during transition (for Docker, dev use). Both paths coexist — setup scripts reference `templates/` after rename.
