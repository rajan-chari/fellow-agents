#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
PTY_WIN_PORT="${1:-3700}"
EMCOM_PORT="${2:-8800}"
REPO="${FELLOW_AGENTS_REPO:-rajan-chari/fellow-agents}"

echo ""
echo "  fellow-agents setup"
echo "  ==================="
echo ""

# --- Detect platform ---
OS="$(uname -s)"
ARCH="$(uname -m)"
case "$OS-$ARCH" in
  Darwin-arm64) PLATFORM="osx-arm64" ;;
  Darwin-x86_64) PLATFORM="osx-x64" ;;
  Linux-x86_64) PLATFORM="linux-x64" ;;
  *) echo "Unsupported platform: $OS-$ARCH"; exit 1 ;;
esac
BIN_DIR="$ROOT/bin/$PLATFORM"

# --- Prerequisites ---
echo "[1/6] Checking prerequisites..."

if ! command -v node &>/dev/null; then echo "Node.js is required. Install from https://nodejs.org/"; exit 1; fi
NODE_VER=$(node --version | tr -d 'v' | cut -d. -f1)
if [ "$NODE_VER" -lt 18 ]; then echo "Node.js 18+ required (found $(node --version))"; exit 1; fi
echo "  Node.js $(node --version)"

if ! command -v claude &>/dev/null; then echo "  Claude Code not found (optional — install from https://claude.ai/code)"
else echo "  Claude Code found"; fi

if ! command -v python3 &>/dev/null; then echo "Python 3.10+ required for emcom-server"; exit 1; fi
echo "  $(python3 --version)"

# --- Download binaries if missing ---
download_release() {
  if [ -f "$BIN_DIR/emcom" ] && [ -d "$ROOT/pty-win" ]; then
    echo "  Binaries already present — skipping download"
    return
  fi
  echo "  Downloading binaries from GitHub Releases..."
  if ! command -v curl &>/dev/null; then
    echo "  curl required for download. Place binaries manually in bin/$PLATFORM/"
    return
  fi
  RELEASE_JSON=$(curl -sf "https://api.github.com/repos/$REPO/releases/latest" 2>/dev/null) || {
    echo "  Could not fetch releases from $REPO"
    echo "  Place binaries manually in bin/$PLATFORM/ and pty-win/"
    return
  }
  TAG=$(echo "$RELEASE_JSON" | grep '"tag_name"' | head -1 | sed 's/.*: "//;s/".*//')
  echo "  Release: $TAG"

  # Download platform binaries
  BIN_URL=$(echo "$RELEASE_JSON" | grep '"browser_download_url"' | grep "$PLATFORM" | head -1 | sed 's/.*: "//;s/".*//')
  if [ -n "$BIN_URL" ]; then
    echo "  Downloading bin-$PLATFORM.zip..."
    curl -sL "$BIN_URL" -o "$ROOT/bin-$PLATFORM.zip"
    (cd "$ROOT" && unzip -qo "bin-$PLATFORM.zip" && rm "bin-$PLATFORM.zip")
    chmod +x "$BIN_DIR"/* 2>/dev/null || true
  else
    echo "  No binary archive found for $PLATFORM"
  fi

  # Download pty-win
  PTY_URL=$(echo "$RELEASE_JSON" | grep '"browser_download_url"' | grep "pty-win" | head -1 | sed 's/.*: "//;s/".*//')
  if [ -n "$PTY_URL" ]; then
    echo "  Downloading pty-win.zip..."
    curl -sL "$PTY_URL" -o "$ROOT/pty-win.zip"
    (cd "$ROOT" && unzip -qo "pty-win.zip" && rm "pty-win.zip")
  else
    echo "  No pty-win archive found"
  fi
}
download_release

if [ ! -f "$BIN_DIR/emcom" ]; then
  echo "emcom binary not found at $BIN_DIR/emcom. Download from GitHub Releases."
  exit 1
fi
echo "  Binaries ready ($PLATFORM)"

# --- Install pty-win ---
echo "[2/6] Installing pty-win..."
if [ -d "$ROOT/pty-win" ]; then
  (cd "$ROOT/pty-win" && [ -d node_modules ] || npm install --production 2>&1 | tail -1)
  (cd "$ROOT/pty-win" && npm link 2>&1 | tail -1)
  echo "  pty-win ready"
else
  echo "  pty-win/ not found — download from GitHub Releases"
fi

# --- Start emcom-server ---
echo "[3/6] Starting emcom-server..."
if [ -f "$BIN_DIR/emcom-server" ]; then
  "$BIN_DIR/emcom-server" &
  EMCOM_PID=$!
else
  # Fallback: pip install
  pip3 install emcom 2>/dev/null || true
  emcom-server &
  EMCOM_PID=$!
fi
sleep 2
for i in $(seq 1 10); do
  curl -sf "http://127.0.0.1:$EMCOM_PORT/api/health" >/dev/null 2>&1 && break
  sleep 0.5
done
echo "  emcom-server running on :$EMCOM_PORT"

# --- Register workspaces ---
echo "[4/6] Registering agents..."
EMCOM="$BIN_DIR/emcom"
for ws in "$ROOT/workspaces"/*/; do
  name=$(basename "$ws")
  id_file="$ws/identity.json"
  if [ -f "$id_file" ]; then
    "$EMCOM" --identity "$id_file" register 2>/dev/null && echo "  Registered: $name" || echo "  Already registered: $name"
  fi
done

# --- Configure hooks ---
echo "[5/6] Configuring Claude Code hooks..."
for ws in "$ROOT/workspaces"/*/; do
  name=$(basename "$ws")
  claude_dir="$ws/.claude"
  mkdir -p "$claude_dir"
  cat > "$claude_dir/settings.local.json" <<HOOKS
{
  "hooks": {
    "Stop": [{"matcher": "", "hooks": [{"type": "http", "url": "http://127.0.0.1:$PTY_WIN_PORT/api/hook/stop", "timeout": 2}]}],
    "Notification": [{"matcher": "idle_prompt|permission_prompt", "hooks": [{"type": "http", "url": "http://127.0.0.1:$PTY_WIN_PORT/api/hook/notify", "timeout": 2}]}],
    "UserPromptSubmit": [{"matcher": "", "hooks": [{"type": "http", "url": "http://127.0.0.1:$PTY_WIN_PORT/api/hook/prompt-submit", "timeout": 2}]}]
  },
  "messageIdleNotifThresholdMs": 5000
}
HOOKS
  echo "  Hooks configured: $name"
done

# --- Start pty-win ---
echo "[6/6] Starting pty-win..."
if command -v pty-win &>/dev/null; then
  pty-win --port "$PTY_WIN_PORT" --root "$ROOT/workspaces" --emcom "http://127.0.0.1:$EMCOM_PORT" &
  PTY_PID=$!
  echo "  pty-win running on :$PTY_WIN_PORT"
else
  echo "  pty-win not in PATH — run 'npm link' in pty-win/"
  PTY_PID=""
fi

# --- Open browser ---
sleep 2
if command -v open &>/dev/null; then open "http://127.0.0.1:$PTY_WIN_PORT"
elif command -v xdg-open &>/dev/null; then xdg-open "http://127.0.0.1:$PTY_WIN_PORT"
fi

echo ""
echo "  Setup complete!"
echo "  pty-win:      http://127.0.0.1:$PTY_WIN_PORT"
echo "  emcom-server: http://127.0.0.1:$EMCOM_PORT"
echo ""
echo "  Press Ctrl+C to stop all services."
echo ""

# --- Wait and cleanup ---
cleanup() {
  echo ""
  echo "  Shutting down..."
  [ -n "${PTY_PID:-}" ] && kill "$PTY_PID" 2>/dev/null
  [ -n "${EMCOM_PID:-}" ] && kill "$EMCOM_PID" 2>/dev/null
  echo "  Stopped."
}
trap cleanup EXIT INT TERM
wait
