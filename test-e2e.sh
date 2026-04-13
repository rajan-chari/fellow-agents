#!/usr/bin/env bash
# E2E test for fellow-agents setup.sh
# Runs each setup step and verifies it worked. Exit 0 = all pass, non-zero = failure.
set -euo pipefail

PASS=0
FAIL=0
report() { if [ "$2" = "ok" ]; then echo "  PASS: $1"; ((PASS++)); else echo "  FAIL: $1"; ((FAIL++)); fi; }

echo ""
echo "  fellow-agents E2E test"
echo "  ======================"
echo ""

# --- Step 1: Prerequisites ---
echo "[1/7] Prerequisites..."
command -v node >/dev/null && report "node $(node --version)" ok || report "node not found" fail
command -v python3 >/dev/null && report "python3 $(python3 --version 2>&1)" ok || report "python3 not found" fail
command -v git >/dev/null && report "git" ok || report "git not found" fail
command -v curl >/dev/null && report "curl" ok || report "curl not found" fail

# --- Step 2: Download binaries ---
echo "[2/7] Running setup.sh download..."
# Source the download function from setup.sh without running the full script
export ROOT=/app
export FELLOW_AGENTS_REPO="${FELLOW_AGENTS_REPO:-rajan-chari/fellow-agents}"

OS="$(uname -s)"
ARCH="$(uname -m)"
case "$OS-$ARCH" in
  Darwin-arm64) PLATFORM="osx-arm64" ;;
  Darwin-x86_64) PLATFORM="osx-x64" ;;
  Linux-x86_64) PLATFORM="linux-x64" ;;
  *) echo "Unsupported: $OS-$ARCH"; exit 1 ;;
esac
BIN_DIR="$ROOT/bin/$PLATFORM"

# Run the download portion of setup.sh
./setup.sh 3700 8800 &
SETUP_PID=$!

# Wait for emcom-server to start (up to 60s)
echo "[3/7] Waiting for emcom-server..."
for i in $(seq 1 60); do
  if curl -sf http://127.0.0.1:8800/api/health >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

# --- Step 3: Verify binaries downloaded ---
echo "[4/7] Verifying binaries..."
[ -f "$BIN_DIR/emcom" ] && report "emcom binary exists" ok || report "emcom binary missing" fail
[ -f "$BIN_DIR/emcom-server" ] && report "emcom-server binary exists" ok || report "emcom-server missing" fail
[ -d "$ROOT/pty-win/dist" ] && report "pty-win dist exists" ok || report "pty-win dist missing" fail
[ -f "$ROOT/bin/.version" ] && report "version file: $(cat $ROOT/bin/.version)" ok || report "version file missing" fail

# --- Step 4: Verify emcom-server health ---
echo "[5/7] Verifying services..."
HTTP_CODE=$(curl -sf -o /dev/null -w '%{http_code}' http://127.0.0.1:8800/api/health 2>/dev/null || echo "000")
[ "$HTTP_CODE" = "200" ] && report "emcom-server health: $HTTP_CODE" ok || report "emcom-server health: $HTTP_CODE" fail

# --- Step 5: Verify pty-win ---
sleep 2
PTY_CODE=$(curl -sf -o /dev/null -w '%{http_code}' http://127.0.0.1:3700 2>/dev/null || echo "000")
[ "$PTY_CODE" = "200" ] && report "pty-win serves UI: $PTY_CODE" ok || report "pty-win not responding: $PTY_CODE" fail

# --- Step 6: Verify agent registration ---
echo "[6/7] Verifying agents..."
WHO=$("$BIN_DIR/emcom" --identity "$ROOT/workspaces/coordinator/identity.json" who 2>&1 || true)
echo "$WHO" | grep -q "coordinator" && report "coordinator registered" ok || report "coordinator not registered" fail
echo "$WHO" | grep -q "coder" && report "coder registered" ok || report "coder not registered" fail
echo "$WHO" | grep -q "reviewer" && report "reviewer registered" ok || report "reviewer not registered" fail

# --- Step 7: Verify hooks configured ---
echo "[7/7] Verifying hooks..."
[ -f "$ROOT/workspaces/coordinator/.claude/settings.local.json" ] && report "coordinator hooks" ok || report "coordinator hooks missing" fail
[ -f "$ROOT/workspaces/coder/.claude/settings.local.json" ] && report "coder hooks" ok || report "coder hooks missing" fail
[ -f "$ROOT/workspaces/reviewer/.claude/settings.local.json" ] && report "reviewer hooks" ok || report "reviewer hooks missing" fail

# --- Cleanup ---
kill $SETUP_PID 2>/dev/null || true
wait $SETUP_PID 2>/dev/null || true

# --- Summary ---
echo ""
echo "  Results: $PASS passed, $FAIL failed"
echo ""
[ "$FAIL" -eq 0 ] && echo "  E2E TEST PASSED" && exit 0
echo "  E2E TEST FAILED" && exit 1
