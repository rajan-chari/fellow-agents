# fellow-agents CLI setup UX improvements

## Context

Rajan asked to improve the `fellow-agents` CLI install and startup experience. The immediate goal is not a full command redesign; it is to make the existing setup flow easier to diagnose, recover, and explain.

This proposal is based on:

- `README.md`, `package.json`, and `src/` inspection.
- emcom request `2fc6f57e` asking Forge for current CLI details.
- emcom draft `a5388e68` sent to Forge/Milo/fa-install agents.
- Milo response `fc8d908d`, which recommended focusing the first tracker slice on doctor/status plus first-run and error-message polish.
- Forge response `a7bb24e1` and Milo response `0bea8080`, which narrowed the first implementation slice and recommended splitting hook preservation into a linked follow-up.

Moss was not registered on emcom at the time, so direct Moss input could not be requested.

## Current user flow

1. User installs with `npm install -g fellow-agents`.
2. npm installs JS entrypoints/shims for:
   - `fellow-agents`
   - `emcom`
   - `emcom-server`
   - `tracker`
   - `pty-win`
   - `pty-cld`
3. User runs `fellow-agents` from a chosen workspace directory.
4. First run prompts for preferred CLI (`claude`, `copilot`, `pi`, or custom path).
5. The CLI downloads release assets into `~/.fellow-agents`.
6. The CLI installs pty-win dependencies.
7. The CLI scaffolds `workspaces/` with coordinator/coder/reviewer.
8. The CLI installs bundled agent skills.
9. The CLI starts `emcom-server` and `pty-win`.
10. The CLI registers agents, writes hooks, and opens the browser.

Existing commands and options include:

- `fellow-agents`
- `fellow-agents stop`
- `fellow-agents clean`
- `fellow-agents uninstall --yes`
- `fellow-agents --update`
- `fellow-agents --port <n>`
- `fellow-agents --emcom-port <n>`
- `fellow-agents --no-browser`
- `fellow-agents config get`
- `fellow-agents config get cliPreference`
- `fellow-agents config set cliPreference <value>`

Runtime cache/state is expected under `~/.fellow-agents`, except scaffolded workspace directories.

`--update` is currently a start option, not a top-level `update` subcommand. There are no `status`, `doctor`, `logs`, `init`, or `agent` verbs today.

## Common confusion and failures

- PATH or shim ambiguity after global npm install, especially stale shims causing `EEXIST` or resolving the wrong command.
- Old cached state under `~/.fellow-agents` masking release changes.
- Port conflicts on `3700` or `8800`.
- `localhost` vs `127.0.0.1` inconsistency; internal tooling should prefer `127.0.0.1`.
- Windows clone/setup path requires PowerShell 7+.
- Custom emcom ports require workspace `identity.json` server URLs to stay consistent.
- `cliPreference` is useful but easy to misunderstand: config should warn on missing commands but still allow future/preinstalled paths.
- Current TypeScript `writeHooks` appears to overwrite `.claude/settings.local.json` instead of preserving existing permissions like the setup scripts do.
- Subcommand help is not consistently mutation-safe: for example, `fellow-agents clean --help` and `fellow-agents stop --help` can execute the command instead of showing help.
- Version drift is central to diagnostics: npm package version, source metadata, GitHub release assets, cached binary version, and pty-win build can differ.

## First implementation slice

Tracker: `eb429b57` - `Improve fellow-agents CLI setup diagnostics and lifecycle UX`.

### 1. Add `doctor` and/or `status`

Report actionable diagnostics:

- npm package version.
- Cached binary/pty-win release version.
- pty-win build information when available.
- Shim and PATH resolution for `fellow-agents`, `emcom`, `tracker`, `pty-win`, and `pty-cld`.
- Node version and pty-win engine compatibility.
- PowerShell version on Windows, especially for clone/setup guidance.
- Preferred CLI value and whether it resolves.
- Port usage for pty-win and emcom-server.
- Service health and PID/log locations.
- Workspace root and scaffolded agent directories.
- Workspace `identity.json` server URL consistency.
- Claude hook presence.
- Installed bundled skills and whether files were written, refreshed, skipped, or customized.

### 2. Make subcommand help mutation-safe

Every subcommand should handle `-h` and `--help` without side effects. This explicitly covers:

- `fellow-agents clean --help`
- `fellow-agents stop --help`
- `fellow-agents uninstall --help`
- `fellow-agents config --help`

### 3. Improve first-run success output

The final success block should include:

- Browser URL.
- emcom URL.
- Workspace root.
- Active CLI preference.
- Log directory.
- Exact commands for stop, clean, update, config, and troubleshooting.

### 4. Make failed starts actionable

Examples:

- Port busy: suggest `--port`, `--emcom-port`, or `fellow-agents stop`.
- Missing global command or shim: suggest `npm install -g fellow-agents`, shell restart, and PATH/shim checks.
- Stale cache: suggest `fellow-agents --update` or `fellow-agents clean`, depending on symptom.
- Missing release asset: name the expected platform or `pty-win` asset and release tag.
- pty-win dependency install failure: show log path and next command.

### 5. Align help and docs

Document the real lifecycle:

- `clean` preserves logs/preferences but wipes cached binaries and pty-win install.
- `uninstall` previews and then removes all state/workspaces with `--yes`.
- `--update` forces redownload.
- `config` manages preferences, currently `cliPreference`.

## Constraints to preserve

- `npm install -g fellow-agents` should stay low side-effect: install package and shims only.
- Runtime data should stay under `~/.fellow-agents`, except scaffolded workspaces.
- Agents and skills should keep using bare commands (`emcom`, `tracker`, `pty-win`) rather than guessed skill-bundled paths.
- Preferences should keep schema and `updatedBy` metadata.
- `config set cliPreference` should warn and write rather than reject a path that does not exist yet.

## Deferred follow-ups

- Preserve and merge `.claude/settings.local.json` safely across fellow-agents and pty-win. Keep unknown settings, existing permissions, and non-owned hooks; replace only pty-win-owned hook entries.
- Larger lifecycle redesign: `init`, `start`, `update`, `logs`.
- Agent management commands: `agent add`, `agent list`, `agent remove`.
- Per-agent CLI command preferences.
- More explicit workspace-root selection instead of silently creating nested `fellow-agents/`.
