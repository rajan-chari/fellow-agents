import {
  readPreferences,
  writePreferences,
  lookupCli,
  preferencesFile,
  KNOWN_KEYS,
  type KnownKey,
} from "../lib/preferences.js";

function printHelp(): void {
  console.log(`fellow-agents config — read or write user preferences

Usage:
  fellow-agents config get                Print all preferences as JSON
  fellow-agents config get <key>          Print the value of a single key
  fellow-agents config set <key> <value>  Write a value (creates the file if missing)

Known keys:
  cliPreference   The CLI launched by pty-win's play button.
                  Bare command (claude | copilot | pi) or full path to an executable.

File: ${preferencesFile}

Examples:
  fellow-agents config set cliPreference claude
  fellow-agents config set cliPreference "C:\\Program Files\\claude\\claude.exe"
  fellow-agents config get cliPreference`);
}

function isKnownKey(key: string): key is KnownKey {
  return (KNOWN_KEYS as readonly string[]).includes(key);
}

export function config(args: string[]): void {
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    printHelp();
    return;
  }

  const sub = args[0];

  if (sub === "get") {
    handleGet(args.slice(1));
    return;
  }

  if (sub === "set") {
    handleSet(args.slice(1));
    return;
  }

  console.error(`Unknown config subcommand: ${sub}`);
  console.error(`Run 'fellow-agents config --help' for usage.`);
  process.exit(1);
}

function handleGet(args: string[]): void {
  const prefs = readPreferences();

  if (args.length === 0) {
    if (prefs === null) {
      console.log("No preferences set.");
      console.log(`Run 'fellow-agents' or 'fellow-agents config set <key> <value>' to create them.`);
      return;
    }
    console.log(JSON.stringify(prefs, null, 2));
    return;
  }

  const key = args[0];
  if (!isKnownKey(key)) {
    console.error(`Unknown key: ${key}`);
    console.error(`Known keys: ${KNOWN_KEYS.join(", ")}`);
    process.exit(1);
  }

  if (prefs === null) {
    console.log("No preferences set.");
    console.log(`Run 'fellow-agents' or 'fellow-agents config set ${key} <value>' to set it.`);
    return;
  }

  const value = (prefs as unknown as Record<string, unknown>)[key];
  if (value === undefined || value === null || value === "") {
    console.log(`${key} is not set.`);
    return;
  }
  console.log(String(value));
}

function handleSet(args: string[]): void {
  if (args.length < 2) {
    console.error("Usage: fellow-agents config set <key> <value>");
    console.error(`Known keys: ${KNOWN_KEYS.join(", ")}`);
    process.exit(1);
  }

  const key = args[0];
  const value = args.slice(1).join(" ");

  if (!isKnownKey(key)) {
    console.error(`Unknown key: ${key}`);
    console.error(`Known keys: ${KNOWN_KEYS.join(", ")}`);
    process.exit(1);
  }

  if (!value.trim()) {
    console.error(`Value for '${key}' cannot be empty.`);
    process.exit(1);
  }

  // cliPreference: warn (don't fail) if where.exe / which doesn't find it.
  // Real use case: user pre-configures before installing the CLI, or the CLI
  // is in a non-default location PATH doesn't see yet. Reject would block valid flows.
  if (key === "cliPreference") {
    const looksLikePath = value.includes("\\") || value.includes("/");
    const resolved = lookupCli(value);
    if (resolved === null && !looksLikePath) {
      const tool = process.platform === "win32" ? "where.exe" : "which";
      console.error(`  WARNING: '${tool} ${value}' returned no matches.`);
      console.error(`  Writing the preference anyway — pty-win will fall back if the CLI is missing at launch time.`);
      console.error(`  Fix later with: fellow-agents config set cliPreference <name-or-path>`);
    }
  }

  const existing = readPreferences();
  const written = writePreferences({
    ...(existing ?? {}),
    [key]: value,
    updatedBy: "config-set",
  });

  console.log(`Set ${key} = ${value}`);
  console.log(`Wrote ${preferencesFile} (schema ${written.schema}, updatedAt ${written.updatedAt}).`);
}
