import { existsSync, readdirSync, mkdirSync, copyFileSync, readFileSync, statSync, rmSync, rmdirSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import { skillsDir } from "./paths.js";

// Three target paths per agentskills.io convention — installed CLIs vary; we write to all three
// so the skill works regardless of which AI CLI the user is using.
const targetRoots = [
  join(homedir(), ".claude", "skills"),    // Claude Code
  join(homedir(), ".copilot", "skills"),   // GitHub Copilot CLI
  join(homedir(), ".agents", "skills"),    // pi + cross-tool universal location
];

interface InstallResult {
  written: string[];   // paths where we wrote new files
  skipped: string[];   // paths where target already existed (likely user-customized)
}

/**
 * Copy bundled skills to all known target paths.
 *
 * Strategy: write if absent. Never overwrite existing files (treated as
 * user-customized). To force a refresh, the user can delete the target file
 * and re-run fellow-agents.
 */
export function installSkills(): InstallResult {
  const result: InstallResult = { written: [], skipped: [] };

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
      for (const root of targetRoots) {
        const targetFile = join(root, skillName, relPath);
        if (existsSync(targetFile)) {
          // User-customized or already-installed — never overwrite
          result.skipped.push(targetFile);
          continue;
        }
        mkdirSync(join(root, skillName, ...relPath.split(/[\\/]/).slice(0, -1)), { recursive: true });
        copyFileSync(sourceFile, targetFile);
        result.written.push(targetFile);
      }
    }
  }

  return result;
}

interface UninstallResult {
  removed: string[];      // files we removed (matched shipped content)
  preserved: string[];    // files we preserved (content differed — user-customized)
}

/**
 * Remove skill files we installed, if the user hasn't modified them.
 *
 * Compares each target file byte-for-byte against the bundled version.
 * Matching → safe to delete (we wrote it, nothing changed). Differing →
 * preserve (user customized or it was already there before we showed up).
 *
 * After file removal, attempts to clean up empty skill directories and
 * empty target root directories (e.g., ~/.copilot/skills/ if user doesn't
 * have Copilot installed).
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
        const sourceFile = join(sourceSkillDir, relPath);
        const targetFile = join(targetSkillDir, relPath);
        if (!existsSync(targetFile)) continue;

        try {
          const sourceBytes = readFileSync(sourceFile);
          const targetBytes = readFileSync(targetFile);
          if (Buffer.compare(sourceBytes, targetBytes) === 0) {
            rmSync(targetFile);
            result.removed.push(targetFile);
          } else {
            result.preserved.push(targetFile);
          }
        } catch {
          // Can't read either file — skip, don't risk data loss
          result.preserved.push(targetFile);
        }
      }

      // Try to remove empty skill dir (best effort — won't remove if user has
      // their own files in there or any preserved files remain)
      tryRemoveIfEmpty(targetSkillDir);
      tryRemoveIfEmpty(root);
    }
  }

  return result;
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
