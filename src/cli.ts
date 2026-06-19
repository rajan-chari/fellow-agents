#!/usr/bin/env node

const args = process.argv.slice(2);

// Default to "start" if no command given or first arg is a flag
const command = args[0] === "stop" ? "stop"
  : args[0] === "clean" ? "clean"
  : args[0] === "uninstall" ? "uninstall"
  : args[0] === "config" ? "config"
  : (args[0] === "status" || args[0] === "doctor") ? "status"
  : (args[0] === "--help" || args[0] === "-h") ? "help"
  : "start";

function getFlag(name: string, fallback: string): string {
  const idx = args.indexOf(name);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
}

function hasFlag(name: string): boolean {
  return args.includes(name);
}

function wantsHelp(rest: string[]): boolean {
  return rest.includes("--help") || rest.includes("-h");
}

function printHelp(): void {
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
  fellow-agents status               Read-only diagnostics (alias: doctor)
  memtool <save|list|query|link|promote-request>
                                    File-backed working-log and field-note memory records

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

function printCommandHelp(cmd: string): void {
  if (cmd === "stop") {
    console.log(`Usage: fellow-agents stop

Stop running fellow-agents services (emcom-server and pty-win).

Options:
  -h, --help    Show this help`);
    return;
  }

  if (cmd === "clean") {
    console.log(`Usage: fellow-agents clean

Stop services and wipe cached binaries, the pty-win install, and PID files.
Preserves logs and preferences.

Options:
  -h, --help    Show this help`);
    return;
  }

  if (cmd === "uninstall") {
    console.log(`Usage: fellow-agents uninstall [--yes] [--dir <path>]

Preview or remove all fellow-agents state, including scaffolded workspaces.
Without --yes this is a dry-run preview.

Options:
  --yes         Actually perform the uninstall
  --dir <path>  Workspace location (default: current)
  -h, --help    Show this help`);
    return;
  }

  if (cmd === "status" || cmd === "doctor") {
    console.log(`Usage: fellow-agents ${cmd} [--port <number>] [--emcom-port <number>] [--dir <path>]

Print read-only diagnostics for installed assets, services, preferences,
workspace identities, hooks, skills, and PATH resolution.

Options:
  --port <number>        pty-win port to check (default: 3700)
  --emcom-port <number>  emcom-server port to check (default: 8800)
  --dir <path>           Workspace location (default: current)
  -h, --help             Show this help`);
    return;
  }

  printHelp();
}

if (command === "start") {
  if (wantsHelp(args)) {
    printHelp();
    process.exit(0);
  }
  const { start } = await import("./commands/start.js");
  await start({
    port: parseInt(getFlag("--port", "3700"), 10),
    emcomPort: parseInt(getFlag("--emcom-port", "8800"), 10),
    dir: getFlag("--dir", process.cwd()),
    noBrowser: hasFlag("--no-browser"),
    update: hasFlag("--update"),
  });
} else if (command === "stop") {
  if (wantsHelp(args.slice(1))) {
    printCommandHelp("stop");
    process.exit(0);
  }
  const { stop } = await import("./commands/stop.js");
  stop();
} else if (command === "clean") {
  if (wantsHelp(args.slice(1))) {
    printCommandHelp("clean");
    process.exit(0);
  }
  const { clean } = await import("./commands/clean.js");
  clean();
} else if (command === "uninstall") {
  if (wantsHelp(args.slice(1))) {
    printCommandHelp("uninstall");
    process.exit(0);
  }
  const { uninstall } = await import("./commands/uninstall.js");
  uninstall({
    dir: getFlag("--dir", process.cwd()),
    yes: hasFlag("--yes"),
  });
} else if (command === "config") {
  const { config } = await import("./commands/config.js");
  config(args.slice(1));
} else if (command === "status") {
  if (wantsHelp(args.slice(1))) {
    printCommandHelp(args[0] ?? "status");
    process.exit(0);
  }
  const { status } = await import("./commands/status.js");
  await status({
    port: parseInt(getFlag("--port", "3700"), 10),
    emcomPort: parseInt(getFlag("--emcom-port", "8800"), 10),
    dir: getFlag("--dir", process.cwd()),
  });
} else {
  printHelp();
}
