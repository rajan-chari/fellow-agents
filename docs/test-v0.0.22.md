# fellow-agents v0.0.22 — Manual Test Script (test-machine edition)

Self-contained. Copy each block into a PowerShell window on your test machine.
Mark each section ✅ / ❌ / ➖ (skipped) in the report at the bottom.

Time: ~30 min if everything passes.

---

## 0. Environment baseline

```powershell
"Node:    $(node --version)"
"npm:     $(npm --version)"
"User:    $env:USERPROFILE"
""
"--- detected CLIs (auto-detect will see these) ---"
$c = (where.exe claude 2>$null | Select-Object -First 1); "claude:  $(if($c){$c}else{'NOT FOUND'})"
$o = (where.exe copilot 2>$null | Select-Object -First 1); "copilot: $(if($o){$o}else{'NOT FOUND'})"
$p = (where.exe pi 2>$null | Select-Object -First 1); "pi:      $(if($p){$p}else{'NOT FOUND'})"
""
"--- port state (should be clean) ---"
"3700: $((netstat -ano | findstr ':3700' | Measure-Object).Count) lines"
"8800: $((netstat -ano | findstr ':8800' | Measure-Object).Count) lines"
```

Required: Node v20 / v22 LTS / v24 LTS. NOT v26 (pty-win dep capped <25). Record values in report.

---

## 1. Clean slate

```powershell
# Stop anything running, remove prior state
fellow-agents stop 2>$null
fellow-agents uninstall --yes 2>$null
npm uninstall -g fellow-agents 2>$null

# Verify clean
Test-Path "$env:USERPROFILE\.fellow-agents"
netstat -ano | findstr ":3700"
netstat -ano | findstr ":8800"

# Install v0.0.22 from npm
npm install -g fellow-agents@0.0.22

# Verify install
npm list -g fellow-agents
fellow-agents --help | Select-Object -First 3
```

Expected:
- `Test-Path` → `False`
- Both netstat calls → no output
- npm install ends with `fellow-agents installed. Run "fellow-agents" to start...`
- `npm list` shows `fellow-agents@0.0.22`

---

## 2. Help text — verify new Commands + Config sections

```powershell
fellow-agents --help
```

Look for:
- Line: `fellow-agents config <get|set>     Read or write user preferences (see 'config --help')`
- Block titled `Config:` between Uninstall and General
- `clean` line says `(preserves logs and preferences)`

```powershell
fellow-agents config --help
fellow-agents config             # same as --help
fellow-agents config -h          # same as --help
```

All three should show the same Usage / Known keys / File path / Examples block.

---

## 3. config error cases (no file yet)

```powershell
fellow-agents config get                          # "No preferences set." + hint  / exit 0
$LASTEXITCODE
fellow-agents config get cliPreference            # similar, mentions cliPreference / exit 0
$LASTEXITCODE
fellow-agents config get unknownKey               # "Unknown key" / exit 1
$LASTEXITCODE
fellow-agents config set                          # Usage / exit 1
$LASTEXITCODE
fellow-agents config set bogusKey foo             # "Unknown key" / exit 1
$LASTEXITCODE
fellow-agents config set cliPreference ""         # "cannot be empty" / exit 1
$LASTEXITCODE
Test-Path "$env:USERPROFILE\.fellow-agents\preferences.json"   # False — no file created
```

---

## 4. config set happy path

```powershell
fellow-agents config set cliPreference claude
Get-Content "$env:USERPROFILE\.fellow-agents\preferences.json"
```

Expected JSON: `schema:1`, `cliPreference:"claude"`, `updatedAt:<ISO>`, `updatedBy:"config-set"`.

```powershell
fellow-agents config get
fellow-agents config get cliPreference            # bare "claude", no quotes
```

---

## 5. config set warning case — bare command not on PATH

```powershell
fellow-agents config set cliPreference nonsense-cli-xyz
$LASTEXITCODE                                      # 0 (warning, not error)
Get-Content "$env:USERPROFILE\.fellow-agents\preferences.json"
```

Expected:
- "Set cliPreference = nonsense-cli-xyz"
- "Wrote ..."
- WARNING block: `'where.exe nonsense-cli-xyz' returned no matches.` + "Writing the preference anyway..."
- File has `cliPreference:"nonsense-cli-xyz"`

---

## 6. config set path case — no warning

```powershell
fellow-agents config set cliPreference "C:\does\not\exist\claude.exe"
$LASTEXITCODE                                      # 0
Get-Content "$env:USERPROFILE\.fellow-agents\preferences.json"
```

Expected:
- NO warning (value contains `\`, treated as path)
- File has `cliPreference:"C:\\does\\not\\exist\\claude.exe"` (escaped backslashes in JSON)

```powershell
# Reset for next sections
fellow-agents config set cliPreference claude
```

---

## 7. Malformed JSON fallback

```powershell
"not valid json {{{" | Set-Content -Path "$env:USERPROFILE\.fellow-agents\preferences.json" -NoNewline
fellow-agents config get
$LASTEXITCODE                                      # 0 — graceful, not crash
```

Expected:
- WARNING about malformed file ("Treating as unset")
- "No preferences set." + hint

```powershell
# Recover
fellow-agents config set cliPreference claude
Get-Content "$env:USERPROFILE\.fellow-agents\preferences.json"   # clean schema:1 again
```

---

## 8. Forward compat — extra unknown keys preserved

```powershell
@'
{
  "schema": 1,
  "cliPreference": "claude",
  "updatedAt": "2026-01-01T00:00:00.000Z",
  "updatedBy": "manual-edit",
  "futureKey": "ignored-for-now"
}
'@ | Set-Content -Path "$env:USERPROFILE\.fellow-agents\preferences.json"

fellow-agents config get                           # JSON includes futureKey
fellow-agents config set cliPreference copilot
Get-Content "$env:USERPROFILE\.fellow-agents\preferences.json"   # futureKey still present
```

Confirms the writer doesn't strip unknown fields — protects when schema:2 keys land alongside.

---

## 9. Full first-time start — interactive prompt (requires real TTY)

```powershell
fellow-agents uninstall --yes
# Confirms dataDir removed; type 'yes' if prompted, then verify

fellow-agents
```

Expected sequence:
1. `Welcome! This is your first run.` banner (5-step orientation)
2. **CLI preference prompt block** with auto-detected CLIs as numbered choices, plus `[<n+1>] Custom path or other command` and `[s] Skip for now`
3. `Choice:` waits for input

### 9a. Pick numbered option
- Type `1`, Enter → "CLI preference set: claude" (or whatever 1 was)
- Then `[1/8] Checking prerequisites...` and rest of setup proceeds
- When you see `Setup complete!` and the browser opens — DON'T close yet, you'll use it in Section 12
- File check from a NEW PowerShell window:
  ```powershell
  Get-Content "$env:USERPROFILE\.fellow-agents\preferences.json"
  # updatedBy should be "first-run-prompt"
  ```

### 9b. Other prompt branches (do these BEFORE Section 9a, each requires uninstall + restart)

For each: `fellow-agents uninstall --yes` then `fellow-agents`, observe the prompt, answer, then `Ctrl+C` when [1/8] reaches.

| # | Input | Expected |
|---|---|---|
| 9b-i | `s` or Enter (empty) | "Skipped — pty-win will pick a default until you set one." File NOT created |
| 9b-ii | `<n+1>` (Custom), then `claude` | No confirm, writes directly with claude |
| 9b-iii | `<n+1>`, then `bogus-cli`, then `y` | Confirm prompt fires, writes "bogus-cli" |
| 9b-iv | `<n+1>`, then `bogus-cli`, then `n` (or Enter) | "Skipped." No file |
| 9b-v | `<n+1>`, then `C:\anywhere.exe` | No confirm (path-like), writes full path |

Verify the file state after each branch by reading `preferences.json`.

End this section with **9a** so you have a running setup for Section 12.

---

## 10. Second run does NOT re-prompt

```powershell
# After Section 9a, services should be running. Ctrl+C if not already done.
# Then run again — preferences.json exists with cliPreference set
fellow-agents
```

Expected: NO "Pick your preferred CLI" prompt. Goes straight to step `[1/8]`.

`Ctrl+C` after `Setup complete!`.

---

## 11. Prompt RE-fires when prefs wiped

```powershell
# A. Delete file directly (simulates user wipe)
fellow-agents stop
Remove-Item "$env:USERPROFILE\.fellow-agents\preferences.json"
fellow-agents
# Expect: prompt fires. Ctrl+C after choosing.

# B. Schema-only file (no cliPreference)
fellow-agents stop
'{ "schema": 1 }' | Set-Content -Path "$env:USERPROFILE\.fellow-agents\preferences.json"
fellow-agents
# Expect: prompt fires. Ctrl+C after choosing.

# Verify final file preserves schema, adds cliPreference + updatedAt + updatedBy
Get-Content "$env:USERPROFILE\.fellow-agents\preferences.json"
```

---

## 12. pty-win v0.1.31 — flatten right-click menu (browser, visual)

If services are still running, navigate to `http://127.0.0.1:3700`. Otherwise:

```powershell
fellow-agents stop
fellow-agents config set cliPreference claude
fellow-agents
# Browser auto-opens
```

In the browser:
1. **Right-click the ▶ play button** on any agent tab (coder/coordinator/reviewer)
2. Observe the menu — should be FLAT (no submenus):
   - `Resume`
   - `---`
   - Preset list with **★** on whichever matches your cliPreference
   - `---`
   - `Custom...`
3. **Click a non-default preset** (e.g. Copilot) → tab launches Copilot CLI ✅
4. Right-click ▶ again
5. **Right-click a different preset** → that preset becomes the new default (★ moves)
6. The menu should NOT collapse during the star-move (recursive render closure per moss)

⚠️ NOTE: In v0.0.22, the star position is currently driven by **localStorage `pty-win-ai-default`**, NOT preferences.json — that wire-up lands in v0.1.32. So right now:
- v0.0.22 backend (preferences.json) ✅ works
- v0.1.31 flatten ✅ works
- But the two aren't connected yet — they unify in v0.1.32

Don't fail this section if the star doesn't track preferences.json — that's v0.1.32's job.

```powershell
fellow-agents stop
```

---

## 13. Clean preserves preferences

```powershell
# Should have preferences.json from earlier sections
$before = Get-Content "$env:USERPROFILE\.fellow-agents\preferences.json" -Raw
fellow-agents clean
```

Expected in output:
- `Removed bin/ (... MB)`
- `Removed pty-win/ (... MB)`
- `Removed pid/ (... B)`
- `Cleaned ... MB from ...`
- `Logs preserved at ...`
- **`Preferences preserved at ...\preferences.json (if set)`**

```powershell
Test-Path "$env:USERPROFILE\.fellow-agents\preferences.json"            # True
$after = Get-Content "$env:USERPROFILE\.fellow-agents\preferences.json" -Raw
$before -eq $after                                                       # True (byte-identical)
```

---

## 14. Uninstall removes preferences

```powershell
fellow-agents uninstall                            # dry-run (no --yes)
# Should show dataDir in the list of things to remove
fellow-agents uninstall --yes
Test-Path "$env:USERPROFILE\.fellow-agents\preferences.json"            # False
Test-Path "$env:USERPROFILE\.fellow-agents"                             # False
```

---

## 15. Regression — existing commands still work

```powershell
fellow-agents --help                               # renders
fellow-agents stop                                 # graceful when nothing running
fellow-agents clean                                # works on empty state
fellow-agents uninstall                            # dry-run

# Full e2e
fellow-agents
# Walk through prompts, watch all 8 steps complete, browser opens
# Verify three tabs (coder/coordinator/reviewer) scaffolded
fellow-agents stop
```

---

## 16. v0.1.32 / v0.1.33 — DEFER

These ship AFTER v0.0.22 release goes live, so they're not testable yet:

- **v0.1.32**: ▶ play button reads cliPreference from preferences.json instead of localStorage. Updates immediately when `fellow-agents config set` writes (re-read on each spawn).
- **v0.1.33**: Gear icon top-right of header → Settings modal → cliPreference dropdown + Custom path. Writes via POST /api/preferences with `updatedBy: "pty-win-settings"`. Right-click-set-default writes with `updatedBy: "pty-win-play"`.

When those land, smoke-test:
1. `fellow-agents config set cliPreference copilot` → new tab → ▶ → Copilot launches
2. Race case: open pty-win during fellow-agents first-run → silent fallback to first-found CLI, no error
3. Gear icon → Settings → change CLI → save → next tab uses new value
4. Verify `updatedBy` values in preferences.json reflect the surface used

---

## Test report

```
v0.0.22 manual test — <date>, <tester>
Node version:   <v...>
OS:             Windows / Mac / Linux
fellow-agents:  0.0.22 (from npm)

Section  0:  ✅ / ❌ / ➖   notes:
Section  1:  ✅ / ❌ / ➖   notes:
Section  2:  ✅ / ❌ / ➖   notes:
Section  3:  ✅ / ❌ / ➖   notes:
Section  4:  ✅ / ❌ / ➖   notes:
Section  5:  ✅ / ❌ / ➖   notes:
Section  6:  ✅ / ❌ / ➖   notes:
Section  7:  ✅ / ❌ / ➖   notes:
Section  8:  ✅ / ❌ / ➖   notes:
Section  9:  9a ✅  9b-i ✅  9b-ii ✅  9b-iii ✅  9b-iv ✅  9b-v ✅
Section 10:  ✅ / ❌ / ➖   notes:
Section 11:  A ✅  B ✅
Section 12:  ✅ / ❌ / ➖   notes:
Section 13:  ✅ / ❌ / ➖   notes:
Section 14:  ✅ / ❌ / ➖   notes:
Section 15:  ✅ / ❌ / ➖   notes:
Section 16:  ➖ deferred (v0.1.32/v0.1.33)

Failures / surprises:
- ...

Overall: PASS / FAIL
```
