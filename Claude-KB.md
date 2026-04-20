# Claude-KB — forge (fellow-agents)

## Lessons Learned

- **Onboarding message must include "onboarding loaded"** — Rajan uses this phrase to confirm the agent read onboarding.md. Missed it on first message; sent follow-up. Always include it in the initial emcom to Rajan.
- **Glob times out on broad searches** — Searching `C:\s\projects\work\teams\working` with `**/filename.md` hits a 20-second timeout. Use direct paths or narrower search scopes.

## Decisions

(None yet)

## Facts

- fellow-agents v0.0.6 provides: `fellow-agents` (main CLI), `emcom`, `emcom-server`, `tracker`, `pty-win`, `pty-cld`
- Binary shims are in `dist/shims/`, declared in `package.json` bin field
- Templates for coordinator/coder/reviewer roles live under `templates/`
- This workspace is Infrastructure archetype — I build the tooling the team uses

## Open Questions

- What are the current priorities for the fellow-agents project?
- Who should I coordinate with most closely? (frost/emcom, moss/pty-win, pine/pty-cld seem likely)
