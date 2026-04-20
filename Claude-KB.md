# Claude-KB — forge (fellow-agents)

## Lessons Learned

- **Onboarding message must include "onboarding loaded"** — Rajan uses this phrase to confirm the agent read onboarding.md. Missed it on first message; sent follow-up. Always include it in the initial emcom to Rajan.
- **Glob times out on broad searches** — Searching `C:\s\projects\work\teams\working` with `**/filename.md` hits a 20-second timeout. Use direct paths or narrower search scopes.

- **Never restart emcom-server on port 8800 during dev** — kills all agent comms. Use a different port for testing. (Source: Rajan, 2026-04-20)
- **fellow-agents binaries come from GitHub Releases** — built via `release.yml`, tag push triggers multi-platform builds. The npm package is the JS/shim layer.
- **pty-win uses @homebridge/node-pty-prebuilt-multiarch** — no build tools needed on target. onnxruntime-node is optional and degrades gracefully. (Source: moss, 2026-04-20)
- **Setup step 6 merges permissions with hooks** — don't overwrite `settings.local.json` without preserving existing permissions. (Source: milo, 2026-04-20)
- **Setup scripts are 7 steps** (was 6). Step 4 clears stale config (identity.json URL rewrite). (Source: milo, 2026-04-20)

## Decisions

(None yet)

## Facts

- fellow-agents v0.0.6 provides: `fellow-agents` (main CLI), `emcom`, `emcom-server`, `tracker`, `pty-win`, `pty-cld`
- Binary shims are in `dist/shims/`, declared in `package.json` bin field
- Templates for coordinator/coder/reviewer roles live under `templates/`
- This workspace is Infrastructure archetype — I build the tooling the team uses
- emcom CLI: `--body` is the canonical flag, `--message` is an alias
- pty-win build: `npm run build` → `dist/` (TS → ESM). Global shim via `npm link`. CI: `.github/workflows/build.yml` (3 OS x 3 Node matrix + npm pack artifact)
- milo handles dist pull from upstream projects into fellow-agents
- frost: tracker opened-by/responders fields are now live
- emcom.exe is C# AOT (`emcomcs/` in banana/emcom), tracker.exe same (`trackercs/`). emcom-server.exe is PyInstaller (Python). All deploy to `~/.claude/skills/emcom/bin/`
- emcom.exe has `ensure_server()` — auto-starts emcom-server if `/health` fails. emcom-server must be co-located or on PATH
- PyInstaller builds need `--runtime-tmpdir` to avoid AppLocker blocks (see `emcom-server.spec`)
- `deploy.ps1` in the emcom dir handles safe deployment with version check + backup
- GHA release workflow pulls pty-cld from banana/main automatically — no manual copy needed
- pty-cld v0.2.1 (commit 706ffd6 on banana/main) pending: 3 perf optimizations (output batching, deferred xterm parsing, async logging). Needs Rajan to push a tag.
- pty-cld shim is simple: wraps `node dist/index.js` with passthrough args
- .gitignore tracks `templates/*/.claude/settings.local.json` but ignores the rest of `.claude/`
- setup.ps1 requires pwsh 7 — PS 5.1 compat is a known limitation (workaround: fc06605)

## Open Questions

- How exactly does the GHA release workflow pull from banana/main for pty-cld? (Need to read release.yml)
- Next release tag: Rajan needs to push it to pick up pty-cld v0.2.1 — when?
