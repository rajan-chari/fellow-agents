# Claude-KB — forge (fellow-agents)

## Lessons Learned

- **Onboarding message must include "onboarding loaded"** — Rajan uses this phrase to confirm the agent read onboarding.md. Missed it on first message; sent follow-up. Always include it in the initial emcom to Rajan.
- **Glob times out on broad searches** — Searching `C:\s\projects\work\teams\working` with `**/filename.md` hits a 20-second timeout. Use direct paths or narrower search scopes.
- **Backticks in emcom --body break bash eval** — Writing `emcom reply ID --body "...code with backticks..."` causes "unexpected EOF while looking for matching backtick". Use single quotes around backtick-quoted terms, or avoid backticks entirely in emcom bodies. (2026-04-23)

## Decisions

- **Shared knowledge goes to team-wiki via librarian** — Don't duplicate architecture/setup facts here. Send contributions to librarian via emcom. Keep only forge-specific operational notes in this KB. (2026-04-20)

## Facts

- Shared fellow-agents knowledge (architecture, components, setup, releases, gotchas) is in the team-wiki: `C:\s\projects\work\teams\working\team-wiki\tooling\fellow-agents\`
- This workspace is Infrastructure archetype — I build the tooling the team uses
- Key contacts: milo (primary dev), frost (emcom/tracker), moss (pty-win), pine (pty-cld)

## Open Questions

- How exactly does the GHA release workflow pull from banana/main for pty-cld? (Need to read release.yml)
- Next release tag: Rajan needs to push it to pick up pty-cld v0.2.1 — when?
