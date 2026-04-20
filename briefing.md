# Briefing
Last updated: 2026-04-20 18:02

## Current Focus
Onboarding complete. Fully oriented — all team contacts responded, KB populated. Awaiting first real assignment or picking up a Watching item.

## Don't Forget
- Uncommitted `package.json` / `package-lock.json` / `.claude/settings.local.json` changes pre-date this agent — investigate whether intentional
- npm-publish CI job disabled pending NPM_TOKEN secret (commit `d5c2356`)
- Next GHA release tag needed from Rajan to pick up pty-cld v0.2.1
- This workspace is different from others: forge develops the tooling (emcom, pty-win, tracker, pty-cld shims) that all other agents use
- Never restart emcom-server on port 8800 during dev — kills all agent comms

## Recent
### 4/20 15:19–15:59
Received replies from all four key contacts:
- **milo**: Ubuntu VM feedback items mostly resolved (4/5 fixed, 1 was moss). Handed off key areas: NPM_TOKEN, next GHA release (needs Rajan tag for pty-cld v0.2.1), template improvements. Gotchas: 7-step setup, settings.local.json merge, .gitignore pattern.
- **frost**: emcom.exe/tracker.exe are C# AOT, emcom-server is PyInstaller Python. ensure_server() auto-starts server. AppLocker needs --runtime-tmpdir. tracker opened-by/responders now live.
- **moss**: pty-win build details — TS→ESM, prebuilt node-pty, optional onnxruntime.
- **pine**: pty-cld v0.2.1 pending (3 perf opts). GHA release auto-pulls from banana/main. Wants heads up before shim/download changes.
Claude-KB.md updated with all facts and gotchas. Checkpoint committed and pushed (`c70fbac`).

### 4/20 14:15
Registered on emcom as "forge". Read onboarding.md and team-manual.md. Completed setup checklist: CLAUDE.md, Claude-KB.md, briefing.md, tracker.md (team-manual format), .gitignore updated. Sent intro to Rajan (follow-up with "onboarding loaded"), milo, frost, moss, pine. Rajan confirmed priorities: template improvements, fresh install cleanup, npm package experience. Committed and pushed (`c027f76`).

--- new session ---

### 4/18 12:01
Prior session (pre-forge identity). Minimal activity — oriented to repo, created initial briefing.md and tracker.md, committed and pushed (`78c297f`). No code changes made.

## Next Up
1. Investigate uncommitted package.json changes — determine if intentional
2. Understand release.yml workflow (how pty-cld auto-pulls from banana/main)
3. Pick up work: template improvements, NPM_TOKEN setup, or whatever Rajan assigns
