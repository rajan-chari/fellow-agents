#!/usr/bin/env node

const args = process.argv.slice(2);

// Default to "start" if no command given or first arg is a flag
const command = args[0] === "stop" ? "stop"
  : args[0] === "clean" ? "clean"
  : args[0] === "uninstall" ? "uninstall"
  : (args[0] === "--help" || args[0] === "-h") ? "help"
  : "start";

function getFlag(name: string, fallback: string): string {
  const idx = args.indexOf(name);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
}

function hasFlag(name: string): boolean {
  return args.includes(name);
}

if (command === "start") {
  const { start } = await import("./commands/start.js");
  await start({
    port: parseInt(getFlag("--port", "3700"), 10),
    emcomPort: parseInt(getFlag("--emcom-port", "8800"), 10),
    dir: getFlag("--dir", process.cwd()),
    noBrowser: hasFlag("--no-browser"),
    update: hasFlag("--update"),
  });
} else if (command === "stop") {
  const { stop } = await import("./commands/stop.js");
  stop();
} else if (command === "clean") {
  const { clean } = await import("./commands/clean.js");
  clean();
} else if (command === "uninstall") {
  const { uninstall } = await import("./commands/uninstall.js");
  uninstall({
    dir: getFlag("--dir", process.cwd()),
    yes: hasFlag("--yes"),
  });
} else {
  console.log(`fellow-agents — multi-agent system for Claude Code

Usage:
  fellow-agents [options]            Start services (default)
  fellow-agents stop                 Stop all running services
  fellow-agents clean                Wipe cached binaries + pty-win, preserve logs
  fellow-agents uninstall [--yes]    Remove all fellow-agents state (data dir + workspaces)

Options:
  --port <number>       pty-win port (default: 3700)
  --emcom-port <number> emcom-server port (default: 8800)
  --dir <path>          Working directory (default: current)
  --no-browser          Don't open browser
  --update              Force re-download binaries
  --yes                 Skip confirmation prompt (uninstall only)

  -h, --help            Show this help`);
}
