#!/usr/bin/env node

const args = process.argv.slice(2);

// Default to "start" if no command given or first arg is a flag
const command = args[0] === "stop" ? "stop"
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
} else {
  console.log(`fellow-agents — multi-agent system for Claude Code

Usage:
  fellow-agents [options]            Start services (default)
  fellow-agents stop                 Stop all running services

Options:
  --port <number>       pty-win port (default: 3700)
  --emcom-port <number> emcom-server port (default: 8800)
  --dir <path>          Working directory (default: current)
  --no-browser          Don't open browser
  --update              Force re-download binaries

  -h, --help            Show this help`);
}
