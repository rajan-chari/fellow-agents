# Briefing
Last updated: 2026-04-20 22:02

## Current Focus
Onboarding complete. Wiki seeded and persisted. Idle — awaiting assignment or picking up a Watching item.

## Don't Forget
- Uncommitted `package.json` / `package-lock.json` / `.claude/settings.local.json` changes pre-date this agent — investigate whether intentional
- npm-publish CI job disabled pending NPM_TOKEN secret (commit `d5c2356`)
- Next GHA release tag needed from Rajan to pick up pty-cld v0.2.1
- This workspace is different from others: forge develops the tooling (emcom, pty-win, tracker, pty-cld shims) that all other agents use
- Never restart emcom-server on port 8800 during dev — kills all agent comms
- Wiki contributions: shared knowledge → `librarian`, sensitive content → `private-librarian` (global rule updated)

## Recent
### 4/20 19:03–21:09
Team wiki launched. Rajan asked me to seed `tooling/fellow-agents/` — sent two messages to librarian (architecture overview + setup gotchas). Librarian wrote architecture.md, setup.md, releases.md, index.md. Verified content accuracy. Rajan then asked me to persist wiki in CLAUDE.md — added Team Wiki section with path, ownership, librarian workflow, and wiki read as startup step 3. Committed and pushed (`4c34ca3`). Cleaned up Claude-KB.md to defer shared facts to wiki, keeping only forge-specific operational notes. Global team-onboarding rule updated to include wiki contribution guidelines (librarian vs private-librarian routing).

### 4/20 15:19–15:59
Received replies from all four key contacts:
- **milo**: Ubuntu VM feedback items mostly resolved (4/5 fixed, 1 was moss). Handed off key areas: NPM_TOKEN, next GHA release (needs Rajan tag for pty-cld v0.2.1), template improvements.
- **frost**: emcom.exe/tracker.exe are C# AOT, emcom-server is PyInstaller Python. tracker opened-by/responders now live.
- **moss**: pty-win build details — TS→ESM, prebuilt node-pty, optional onnxruntime.
- **pine**: pty-cld v0.2.1 pending (3 perf opts). GHA release auto-pulls from banana/main.
Checkpoint committed and pushed (`c70fbac`).

### 4/20 14:15
Registered on emcom as "forge". Completed onboarding checklist. Committed and pushed (`c027f76`).

--- new session ---

### 4/18 12:01
Prior session (pre-forge identity). Created initial briefing.md and tracker.md (`78c297f`).

## Next Up
1. Investigate uncommitted package.json changes — determine if intentional
2. Understand release.yml workflow (how pty-cld auto-pulls from banana/main)
3. Pick up work: template improvements, NPM_TOKEN setup, or whatever Rajan assigns
