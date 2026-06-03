import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync, unlinkSync } from "fs";
import { join } from "path";
import { execFileSync } from "child_process";
import { dataDir } from "./paths.js";

/** ~/.fellow-agents/preferences.json */
export const preferencesFile = join(dataDir, "preferences.json");

export const CURRENT_SCHEMA = 1;

export type UpdatedBy = "first-run-prompt" | "config-set" | "manual-edit" | "pty-win-play" | "pty-win-settings" | string;

export interface Preferences {
  schema: number;
  cliPreference?: string;
  updatedAt?: string;
  updatedBy?: UpdatedBy;
}

/** Known CLI names — used by autoDetectClis() and as the default preset list for first-run prompt. */
export const KNOWN_CLIS = ["claude", "copilot", "pi"] as const;
export type KnownCli = (typeof KNOWN_CLIS)[number];

/** Known preference keys (for config get/set validation + --help listing). */
export const KNOWN_KEYS = ["cliPreference"] as const;
export type KnownKey = (typeof KNOWN_KEYS)[number];

/**
 * UI schema descriptor for each known key. Source of truth for any UI that wants
 * to render an edit form (e.g. pty-win settings panel in v0.1.33).
 *
 * Mirroring convention: pty-win frontend duplicates this descriptor in its app.js.
 * When adding a new key, update BOTH here and pty-win/app.js. Pattern matches how
 * KNOWN_CLIS is duplicated across the stack — small drift risk, no plumbing tax.
 *
 * Type renderers:
 *   - "select" with `allowCustom: true` → dropdown + optional custom input
 *   - "number" → numeric input with optional min/max
 *   - "string" → plain text input
 *   - "boolean" → checkbox / toggle
 */
export interface KeySchema {
  type: "select" | "number" | "string" | "boolean";
  label: string;
  description?: string;
  options?: string[];
  allowCustom?: boolean;
  customLabel?: string;
  min?: number;
  max?: number;
}

export const KEY_SCHEMAS: Record<KnownKey, KeySchema> = {
  cliPreference: {
    type: "select",
    label: "Default CLI",
    description: "The CLI launched by pty-win's play button in each new tab.",
    options: [...KNOWN_CLIS],
    allowCustom: true,
    customLabel: "Custom path…",
  },
};

/**
 * Read preferences from disk.
 * Returns null if file is missing.
 * Returns { schema: CURRENT_SCHEMA } with a warning on the console if file exists but is malformed —
 * caller can decide whether to re-prompt.
 */
export function readPreferences(): Preferences | null {
  if (!existsSync(preferencesFile)) return null;
  try {
    const raw = readFileSync(preferencesFile, "utf-8");
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) throw new Error("not an object");
    if (typeof parsed.schema !== "number") throw new Error("missing schema");
    return parsed as Preferences;
  } catch (err: any) {
    console.error(`  WARNING: ${preferencesFile} is malformed (${err.message}). Treating as unset.`);
    return null;
  }
}

/**
 * Strip a single pair of matched leading/trailing single or double quotes.
 * Defensive helper for user inputs where a shell-style quoted value
 * (`'agency cp'` or `"agency cp"`) gets typed literally — e.g. into a
 * readline prompt or a config-set value after the outer shell has already
 * consumed its own quote layer.
 *
 * Unmatched, mixed, or absent quotes pass through unchanged.
 */
export function stripMatchedQuotes(s: string): string {
  if (s.length < 2) return s;
  const first = s[0];
  const last = s[s.length - 1];
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return s.slice(1, -1);
  }
  return s;
}

/**
 * Write preferences atomically (temp + renameSync — atomic on Windows from Node 10+).
 * Always stamps `updatedAt` to now and `updatedBy` to the supplied value.
 * Ensures dataDir exists. Cleans up the temp file on failure.
 *
 * Preserves forward-compat keys from `prefs` that aren't in the current
 * Preferences type — callers spreading an existing file with future schema:2
 * fields can rely on those fields surviving a schema:1-aware writer.
 */
export function writePreferences(prefs: Omit<Preferences, "schema" | "updatedAt"> & { schema?: number; updatedBy: UpdatedBy }): Preferences {
  mkdirSync(dataDir, { recursive: true });

  const next: Preferences = {
    ...prefs,
    schema: prefs.schema ?? CURRENT_SCHEMA,
    updatedAt: new Date().toISOString(),
    updatedBy: prefs.updatedBy,
  };

  const tmp = `${preferencesFile}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(next, null, 2) + "\n", "utf-8");
    renameSync(tmp, preferencesFile);
  } catch (err) {
    try { if (existsSync(tmp)) unlinkSync(tmp); } catch {}
    throw err;
  }

  return next;
}

/**
 * Look up a CLI on PATH. Returns the resolved full path (first hit), or null if not found.
 * Uses `where.exe` on Windows and `which` on Unix. Never throws.
 *
 * Uses execFileSync with shell: false so user-controlled `name` values
 * (e.g. a cliPreference set by config-set) cannot inject shell metacharacters.
 * Values containing spaces or shell-special chars (`;`, `&`, `|`, `$`, etc.) are
 * passed verbatim as a single argv to where.exe/which — which will simply not
 * find a match and return null, rather than execute arbitrary commands.
 */
export function lookupCli(name: string): string | null {
  const bin = process.platform === "win32" ? "where.exe" : "which";
  try {
    const out = execFileSync(bin, [name], { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    return out.length > 0 ? out[0] : null;
  } catch {
    return null;
  }
}

/**
 * Auto-detect which of the KNOWN_CLIS are on PATH.
 * Returns the subset that resolved, preserving the KNOWN_CLIS priority order.
 */
export function autoDetectClis(): KnownCli[] {
  return KNOWN_CLIS.filter((name) => lookupCli(name) !== null);
}
