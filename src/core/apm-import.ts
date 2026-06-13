// One-way import of Microsoft APM bundles (apm.yml) into a smith bundle.
// See docs/plans/2026-05-31-knowledge-compiler-v2-plan.md (Task 9).
//
// Mapping:
//   - APM `runtimes` entries map to smith `targets` 1:1 for the four
//     runtimes smith natively renders (claude-code, opencode, codex, kiro).
//     copilot/cursor/gemini/windsurf all consume AGENTS.md, so they collapse
//     into the single `agents-md` target. Unknown runtimes are silently
//     dropped (the importer is one-way and best-effort; smith bundles
//     stay schema-valid even if the source has runtimes smith doesn't know
//     about). If the union of mapped + agents-md targets is empty we throw.
//   - APM `references` (url/file entries) become smith knowledge sources.
//     `mcp:` references are dropped (smith MCP servers live in a separate
//     `mcpServers` field — the user wires those up post-import).
//   - `compile.progressive` and `compile.emitAgentsMd` are forced on so the
//     imported bundle renders an AGENTS.md by default — this is the
//     primary value APM bundles bring (their references want a TOC stanza).

import { readFile } from "node:fs/promises";
import { load as parseYaml } from "js-yaml";
import { SmithError } from "./smith-error";
import type { CanonicalConfig, Target } from "./types";

const RUNTIME_TO_TARGET: Record<string, Target | "agents-md" | undefined> = {
  "claude-code": "claude-code",
  opencode: "opencode",
  codex: "codex",
  kiro: "kiro",
  // Runtimes that consume AGENTS.md — fold into the single agents-md target.
  copilot: "agents-md",
  cursor: "agents-md",
  gemini: "agents-md",
  windsurf: "agents-md",
};

interface ApmYaml {
  name?: string;
  version?: string;
  description?: string;
  runtimes?: string[];
  references?: Array<{ url?: string; file?: string; mcp?: unknown }>;
  instructions?: string;
}

export interface ApmImportResult {
  config: CanonicalConfig;
  persona: { identity: string; expertise: string; soul: string; user: string };
}

export interface ApmImportOptions {
  apmPath: string;
}

export async function importApmBundle(opts: ApmImportOptions): Promise<ApmImportResult> {
  const raw = await readFile(opts.apmPath, "utf8");
  const apm = (parseYaml(raw) ?? {}) as ApmYaml;

  if (!apm.name) {
    throw new SmithError({
      code: "validation-failed",
      what: "apm.yml: missing 'name'",
      reasons: ["apm.yml is missing the required 'name' field"],
    });
  }
  if (!apm.description) {
    throw new SmithError({
      code: "validation-failed",
      what: "apm.yml: missing 'description'",
      reasons: ["apm.yml is missing the required 'description' field"],
    });
  }

  const targets: Target[] = [];
  for (const r of apm.runtimes ?? []) {
    const mapped = RUNTIME_TO_TARGET[r];
    if (!mapped) continue; // unknown runtime — silently drop
    if (!targets.includes(mapped as Target)) targets.push(mapped as Target);
  }
  if (targets.length === 0) {
    throw new SmithError({
      code: "validation-failed",
      what: "apm.yml: no recognized runtimes",
      reasons: [
        "no recognized runtimes (supported: claude-code, opencode, codex, kiro, copilot, cursor, gemini, windsurf)",
      ],
    });
  }

  const sources = (apm.references ?? [])
    .filter((r) => r.url || r.file)
    .map((r, i) => {
      if (r.url) {
        return {
          id: `ref-${i + 1}`,
          type: "webpage" as const,
          url: r.url,
          delivery: "file" as const,
          summary: r.url,
        };
      }
      return {
        id: `ref-${i + 1}`,
        // r.file is guaranteed by the .filter() above.
        type: "file" as const,
        path: r.file as string,
        delivery: "file" as const,
      };
    });

  // smith requires description to be >= 10 chars and start with an
  // action phrase (see config-schema.ts). APM bundles in the wild often
  // satisfy both — but we pad short ones with " (imported)" to keep the
  // importer best-effort instead of hard-failing on every short-string
  // bundle. Bundles with descriptions that don't match the action-phrase
  // regex will still fail when the user runs `smith agent validate`,
  // which is the right place to surface that — the import is one-way and
  // the user can edit the rendered bundle before validating.
  const description =
    apm.description.length >= 10 ? apm.description : `${apm.description} (imported)`;

  const config: CanonicalConfig = {
    schemaVersion: 1,
    name: apm.name,
    description,
    targets,
    modelTier: "balanced",
    knowledge: {
      ...(sources.length > 0 ? { sources } : {}),
      compile: { progressive: true, tocMaxLines: 150, emitAgentsMd: true },
    },
  };

  const persona = {
    identity: `# ${apm.name}\n\n${apm.description}\n`,
    expertise:
      apm.instructions ??
      `# Expertise\n\nImported from APM (${opts.apmPath}). Edit this file to flesh out domain knowledge.\n`,
    soul: `# Soul\n\nVoice and tone TBD — edit this file.\n`,
    user: ``,
  };

  return { config, persona };
}
