#!/usr/bin/env node

const args = process.argv.slice(2);
const command = args[0] || "start";

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
} else if (command === "--help" || command === "-h") {
  console.log(`fellow-agents — multi-agent system for Claude Code

Usage:
  fellow-agents start [options]    Start services (download binaries on first run)
  fellow-agents stop               Stop all running services

Options (start):
  --port <number>       pty-win port (default: 3700)
  --emcom-port <number> emcom-server port (default: 8800)
  --dir <path>          Working directory (default: current)
  --no-browser          Don't open browser
  --update              Force re-download binaries

  -h, --help            Show this help`);
} else {
  console.error(`Unknown command: ${command}. Run 'fellow-agents --help' for usage.`);
  process.exit(1);
}
