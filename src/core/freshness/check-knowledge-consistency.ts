/**
 * Doctor section: knowledge-prompt-disk-consistency.
 *
 * For each installed agent, reads the rendered prompt, extracts Knowledge
 * Index bullets, and verifies they resolve to existing files on disk.
 * Also checks repos/ symlinks and manifest-vs-disk consistency.
 */
import { readdir, readFile, readlink, stat } from "node:fs/promises";
import { join } from "node:path";
import { knowledgeDirFor } from "../../io/knowledge-paths";
import type { KnowledgeManifest } from "../knowledge/types";
import type { InstallPaths, Target } from "../types";
import type { PlatformId } from "./types";

export interface KnowledgeConsistencyReport {
  status: "ok" | "drift" | "skipped";
  agents: KnowledgeConsistencyAgentReport[];
  orphanTrees: string[];
}

export interface KnowledgeConsistencyAgentReport {
  agentName: string;
  target: Target;
  promptPath: string;
  indexedFiles: number;
  presentFiles: number;
  missingFiles: string[];
  brokenSymlinks: string[];
  manifestMismatchFiles: string[];
  fix: string;
}

export interface CheckKnowledgeConsistencyInput {
  agentSmithHome: string;
  installPaths: InstallPaths;
  agents: string[];
  /**
   * Optional gating set of platforms whose CLI was detected on PATH. When
   * provided, only the intersection of the default targets
   * (`opencode`, `claude-code`, `codex`) and the installed set is checked.
   * When omitted, all three default targets are checked (back-compat).
   * Note: `agents-md` is a manifest-level target and never appears in
   * `installedPlatforms`, so it is naturally excluded by the cast.
   */
  installedPlatforms?: Set<PlatformId>;
}

const TARGETS_DEFAULT: Target[] = ["opencode", "claude-code", "codex"];

/** Extract `sources/...` paths from Knowledge Index bullets in a prompt. */
function extractIndexBullets(content: string): string[] {
  const results: string[] = [];
  for (const line of content.split("\n")) {
    const m = line.match(/^- (sources\/\S+)/);
    if (m?.[1]) results.push(m[1]);
  }
  return results;
}

function promptPath(agent: string, target: Target, paths: InstallPaths): string {
  if (target === "codex") return join(paths.codex, agent, "SKILL.md");
  return join(paths[target], `${agent}.md`);
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function findBrokenSymlinks(reposDir: string): Promise<string[]> {
  const broken: string[] = [];
  let entries: string[];
  try {
    entries = await readdir(reposDir);
  } catch {
    return [];
  }
  for (const entry of entries) {
    const full = join(reposDir, entry);
    try {
      const target = await readlink(full);
      // readlink succeeded → it's a symlink. Check if target exists.
      const targetPath = target.startsWith("/") ? target : join(reposDir, target);
      if (!(await exists(targetPath))) {
        broken.push(`repos/${entry}`);
      }
    } catch {
      // Not a symlink or can't read — skip
    }
  }
  return broken;
}

async function findManifestMismatches(knowledgeDir: string): Promise<string[]> {
  const manifestPath = join(knowledgeDir, "_manifest.json");
  let raw: string;
  try {
    raw = await readFile(manifestPath, "utf8");
  } catch {
    return [];
  }
  let manifest: KnowledgeManifest;
  try {
    manifest = JSON.parse(raw);
  } catch {
    return [];
  }
  const mismatches: string[] = [];
  for (const source of manifest.sources ?? []) {
    for (const file of source.files ?? []) {
      if (!(await exists(join(knowledgeDir, file.path)))) {
        mismatches.push(file.path);
      }
    }
  }
  return mismatches;
}

export async function checkKnowledgeConsistency(
  input: CheckKnowledgeConsistencyInput,
): Promise<KnowledgeConsistencyReport> {
  // Detect orphan trees from pre-fix refresh-source.ts (wrong path)
  const orphanTrees: string[] = [];
  for (const agent of input.agents) {
    const wrongPath = join(input.agentSmithHome, "agents", agent, "knowledge");
    if (await exists(wrongPath)) orphanTrees.push(wrongPath);
  }

  if (input.agents.length === 0) {
    return { status: "skipped", agents: [], orphanTrees };
  }

  const reports: KnowledgeConsistencyAgentReport[] = [];

  const targets = input.installedPlatforms
    ? TARGETS_DEFAULT.filter((t) => input.installedPlatforms!.has(t as PlatformId))
    : TARGETS_DEFAULT;

  for (const agent of input.agents) {
    const knowledgeDir = knowledgeDirFor(agent, { agentSmithHome: input.agentSmithHome });

    for (const target of targets) {
      const path = promptPath(agent, target, input.installPaths);
      let content: string;
      try {
        content = await readFile(path, "utf8");
      } catch {
        continue; // Not installed for this target
      }

      const bullets = extractIndexBullets(content);
      if (bullets.length === 0) continue; // No knowledge index in this prompt

      let presentFiles = 0;
      const missingFiles: string[] = [];
      for (const bullet of bullets) {
        if (await exists(join(knowledgeDir, bullet))) {
          presentFiles++;
        } else {
          missingFiles.push(bullet);
        }
      }

      const brokenSymlinks = await findBrokenSymlinks(join(knowledgeDir, "repos"));
      const manifestMismatchFiles = await findManifestMismatches(knowledgeDir);

      reports.push({
        agentName: agent,
        target,
        promptPath: path,
        indexedFiles: bullets.length,
        presentFiles,
        missingFiles,
        brokenSymlinks,
        manifestMismatchFiles,
        fix: `smith knowledge fetch ${agent}`,
      });
    }
  }

  if (reports.length === 0) {
    return { status: "skipped", agents: [], orphanTrees };
  }

  const hasDrift = reports.some(
    (r) =>
      r.missingFiles.length > 0 ||
      r.brokenSymlinks.length > 0 ||
      r.manifestMismatchFiles.length > 0,
  );

  return { status: hasDrift ? "drift" : "ok", agents: reports, orphanTrees };
}
