#!/usr/bin/env node

const args = process.argv.slice(2);

// Default to "start" if no command given or first arg is a flag
const command = args[0] === "stop" ? "stop"
  : args[0] === "clean" ? "clean"
  : args[0] === "uninstall" ? "uninstall"
  : args[0] === "config" ? "config"
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
} else if (command === "config") {
  const { config } = await import("./commands/config.js");
  config(args.slice(1));
} else {
  console.log(`fellow-agents — multi-agent system for Claude Code, Copilot CLI, and pi

  Multiple AI sessions on one machine, collaborating via email-style
  messaging (emcom). Type fellow-agents to download binaries, scaffold
  three sample agents (coder, coordinator, reviewer), and open the
  browser UI. Each agent runs in its own pty-win pane.

Commands:
  fellow-agents [options]            Start services (the usual command)
  fellow-agents stop                 Stop running services
  fellow-agents clean                Wipe cached binaries + pty-win install (preserves logs and preferences)
  fellow-agents uninstall [--yes]    Remove all state, including scaffolded workspaces
  fellow-agents config <get|set>     Read or write user preferences (see 'config --help')

Start options:
  --port <number>       pty-win port (default: 3700)
  --emcom-port <number> emcom-server port (default: 8800)
  --dir <path>          Working directory for agent workspaces (default: current)
  --no-browser          Don't open browser after services start
  --update              Force re-download platform binaries

Uninstall options:
  --yes                 Actually perform the uninstall (default is dry-run preview)
  --dir <path>          Workspace location (default: current — use if you ran start elsewhere)

Config:
  fellow-agents config get [key]            Print all preferences, or one value
  fellow-agents config set <key> <value>    Write a preference (e.g. cliPreference claude)

General:
  -h, --help            Show this help

First time? Just run \`fellow-agents\` and follow the prompts.
Docs: https://github.com/rajan-chari/fellow-agents`);
}
