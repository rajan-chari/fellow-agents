import { existsSync, readdirSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, statSync, rmSync, rmdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { createHash } from "crypto";
import { skillsDir } from "./paths.js";

// Three target paths per agentskills.io convention — installed CLIs vary; we write to all three
// so the skill works regardless of which AI CLI the user is using.
const targetRoots = [
  join(homedir(), ".claude", "skills"),    // Claude Code
  join(homedir(), ".copilot", "skills"),   // GitHub Copilot CLI
  join(homedir(), ".agents", "skills"),    // pi + cross-tool universal location
];

// Sidecar suffix — written next to each shipped file, contains the SHA-256 of
// the content we shipped. Used to detect "we wrote this, user hasn't touched"
// vs "user customized" on later installs and uninstall.
const SIDECAR_SUFFIX = ".fellow-agents-shipped";

interface InstallResult {
  written: string[];     // first-time installs
  refreshed: string[];   // safe overwrites — user hadn't modified our previous shipped version
  skipped: string[];     // preserved — user customization or no sidecar (can't prove we own it)
}

/**
 * Copy bundled skills to all known target paths.
 *
 * Update semantics (v0.0.18+):
 * - Target absent: write file + sidecar.
 * - Target has sidecar AND target SHA matches sidecar: we own it, user hasn't
 *   modified — safe to refresh with new content. Write file + update sidecar.
 * - Target has sidecar AND target SHA differs from sidecar: user edited our
 *   shipped file. Preserve, don't touch sidecar.
 * - Target exists with NO sidecar: pre-existing file (pre-v0.0.18 install, or
 *   user-placed). Preserve — we can't prove we own it.
 */
export function installSkills(): InstallResult {
  const result: InstallResult = { written: [], refreshed: [], skipped: [] };

  if (!existsSync(skillsDir)) return result;

  const skillNames = readdirSync(skillsDir).filter((name) => {
    try {
      return statSync(join(skillsDir, name)).isDirectory();
    } catch {
      return false;
    }
  });

  for (const skillName of skillNames) {
    const sourceSkillDir = join(skillsDir, skillName);
    const skillFiles = walkSkillFiles(sourceSkillDir);

    for (const relPath of skillFiles) {
      const sourceFile = join(sourceSkillDir, relPath);
      const sourceSha = sha256File(sourceFile);

      for (const root of targetRoots) {
        const targetFile = join(root, skillName, relPath);
        const sidecarFile = targetFile + SIDECAR_SUFFIX;

        if (!existsSync(targetFile)) {
          // First-time install
          mkdirSync(join(root, skillName, ...relPath.split(/[\\/]/).slice(0, -1)), { recursive: true });
          copyFileSync(sourceFile, targetFile);
          writeFileSync(sidecarFile, sourceSha, "utf-8");
          result.written.push(targetFile);
          continue;
        }

        // Target exists — decide based on sidecar
        if (!existsSync(sidecarFile)) {
          // No sidecar → we can't prove we own this file, preserve
          result.skipped.push(targetFile);
          continue;
        }

        const recordedSha = readFileSync(sidecarFile, "utf-8").trim();
        const currentSha = sha256File(targetFile);

        if (currentSha === recordedSha) {
          // Target matches what we previously shipped → user hasn't touched → safe refresh
          if (currentSha === sourceSha) {
            // Same shipped version, nothing to do
            result.skipped.push(targetFile);
          } else {
            copyFileSync(sourceFile, targetFile);
            writeFileSync(sidecarFile, sourceSha, "utf-8");
            result.refreshed.push(targetFile);
          }
        } else {
          // User edited the file after we shipped it — preserve
          result.skipped.push(targetFile);
        }
      }
    }
  }

  return result;
}

interface UninstallResult {
  removed: string[];      // files we removed (sidecar matched current content)
  preserved: string[];    // files we preserved (no sidecar, or sidecar mismatch)
}

/**
 * Remove skill files we installed, if the user hasn't modified them.
 *
 * Sidecar-based ownership detection (v0.0.18+):
 * - Target has sidecar AND target SHA matches sidecar → we own it, user
 *   hasn't touched → delete file + sidecar.
 * - Target has sidecar AND target SHA differs → user customized → preserve
 *   (file and sidecar).
 * - Target has no sidecar → we can't prove we own it → preserve.
 *
 * After file removal, attempts to clean up empty skill directories and
 * empty target root directories.
 */
export function uninstallSkills(): UninstallResult {
  const result: UninstallResult = { removed: [], preserved: [] };

  if (!existsSync(skillsDir)) return result;

  const skillNames = readdirSync(skillsDir).filter((name) => {
    try {
      return statSync(join(skillsDir, name)).isDirectory();
    } catch {
      return false;
    }
  });

  for (const skillName of skillNames) {
    const sourceSkillDir = join(skillsDir, skillName);
    const skillFiles = walkSkillFiles(sourceSkillDir);

    for (const root of targetRoots) {
      const targetSkillDir = join(root, skillName);
      if (!existsSync(targetSkillDir)) continue;

      for (const relPath of skillFiles) {
        const targetFile = join(targetSkillDir, relPath);
        const sidecarFile = targetFile + SIDECAR_SUFFIX;
        if (!existsSync(targetFile)) continue;

        if (!existsSync(sidecarFile)) {
          // No sidecar — can't prove ownership, preserve
          result.preserved.push(targetFile);
          continue;
        }

        try {
          const recordedSha = readFileSync(sidecarFile, "utf-8").trim();
          const currentSha = sha256File(targetFile);
          if (currentSha === recordedSha) {
            rmSync(targetFile);
            rmSync(sidecarFile);
            result.removed.push(targetFile);
          } else {
            result.preserved.push(targetFile);
          }
        } catch {
          result.preserved.push(targetFile);
        }
      }

      tryRemoveIfEmpty(targetSkillDir);
      tryRemoveIfEmpty(root);
    }
  }

  return result;
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function tryRemoveIfEmpty(dir: string): void {
  try {
    if (existsSync(dir) && readdirSync(dir).length === 0) {
      rmdirSync(dir);
    }
  } catch {}
}

function walkSkillFiles(dir: string, prefix = ""): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const rel = prefix ? `${prefix}/${entry}` : entry;
    try {
      const stat = statSync(full);
      if (stat.isDirectory()) {
        results.push(...walkSkillFiles(full, rel));
      } else {
        results.push(rel);
      }
    } catch {}
  }
  return results;
}
