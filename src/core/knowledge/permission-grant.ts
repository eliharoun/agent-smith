import type { RenderedAgent, Target } from "../types";

type Frontmatter = Record<string, unknown>;

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/**
 * Inject an implicit read-allow grant for the per-agent knowledge directory
 * into the rendered agent's appropriate field.
 *
 * Format-aware:
 *  - markdown-frontmatter: mutates the per-target frontmatter field
 *    (opencode permission.read, claude-code additionalDirectories, codex
 *    allowed_external_directories) via `injectByTargetIntoFrontmatter`.
 *  - json: branch lands in Commit 2 with the kiro target. For now,
 *    returns rendered unchanged (no JSON-target translator exists yet).
 *
 * Returns a new RenderedAgent — never mutates the input.
 */
export function injectKnowledgeIntoRender(
  rendered: RenderedAgent,
  knowledgeDir: string | undefined,
): RenderedAgent {
  if (!knowledgeDir) return rendered;

  if (rendered.format === "markdown-frontmatter") {
    return {
      ...rendered,
      frontmatter: injectByTargetIntoFrontmatter(
        rendered.target,
        rendered.frontmatter,
        knowledgeDir,
      ),
    };
  }

  // format === "json" — kiro case. Append a file:// URI for the knowledge
  // dir to data.resources, dedupe, and sort for deterministic output
  // (required for the manifest's hash-match idempotency).
  const data = clone(rendered.data);
  const existing = Array.isArray(data.resources) ? [...(data.resources as string[])] : [];
  const uri = `file://${knowledgeDir}/**`;
  if (!existing.includes(uri)) existing.push(uri);
  data.resources = existing.sort();
  return { ...rendered, data };
}

/**
 * Per-target frontmatter mutation for the markdown-frontmatter format.
 *
 * Exported for unit testing the per-target logic in isolation. Production
 * callers should use `injectKnowledgeIntoRender`, which dispatches on
 * `rendered.format` and handles JSON-format targets too.
 *
 * Behavior is unchanged from the previous `injectKnowledgeReadAllow` —
 * this is the same logic, renamed and scoped to the markdown branch.
 */
export function injectByTargetIntoFrontmatter(
  target: Target,
  frontmatter: Frontmatter,
  knowledgeDir: string,
): Frontmatter {
  const out = clone(frontmatter);
  const pattern = `${knowledgeDir}/**`;

  switch (target) {
    case "opencode": {
      const perm = (out.permission as Record<string, unknown> | undefined) ?? {};
      let read = perm.read as string | Record<string, string> | undefined;
      if (typeof read === "string") {
        read = { "**": read, [pattern]: "allow" };
      } else if (read === undefined) {
        read = { [pattern]: "allow" };
      } else {
        read = { ...read, [pattern]: "allow" };
      }
      out.permission = { ...perm, read };
      return out;
    }
    case "claude-code": {
      const cur = Array.isArray(out.additionalDirectories)
        ? (out.additionalDirectories as string[])
        : [];
      if (!cur.includes(knowledgeDir)) cur.push(knowledgeDir);
      out.additionalDirectories = cur;
      return out;
    }
    case "codex": {
      const cur = Array.isArray(out.allowed_external_directories)
        ? (out.allowed_external_directories as string[])
        : [];
      if (!cur.includes(knowledgeDir)) cur.push(knowledgeDir);
      out.allowed_external_directories = cur;
      return out;
    }
    case "kiro": {
      // Unreachable in production: kiro uses format='json'; the json branch
      // in injectKnowledgeIntoRender (Task 2.3) handles it before this
      // function is reached. Throwing surfaces any future caller that
      // bypasses the format-aware dispatch.
      throw new Error(
        "BUG: injectByTargetIntoFrontmatter called with kiro target — call injectKnowledgeIntoRender",
      );
    }
    default: {
      const _exhaustive: never = target;
      throw new Error(`Unhandled target: ${String(_exhaustive)}`);
    }
  }
}

/**
 * Inject platform-convention URIs into the rendered agent (Task 3.6).
 *
 * Format-aware:
 *  - json (kiro): append URIs to data.resources, dedupe, sort for
 *    deterministic output (manifest hash idempotency).
 *  - markdown-frontmatter: no-op for v1. Future commits will register
 *    conventions for opencode/claude-code/codex (CLAUDE.md, AGENTS.md, etc.)
 *    and add per-target frontmatter mutation here at that time.
 *
 * Mirrors injectKnowledgeIntoRender's dispatch pattern. Called by
 * renderForTargets AFTER injectKnowledgeIntoRender so conventions and
 * knowledge dirs coexist in the same resources array.
 */
export function injectPlatformConventions(
  rendered: RenderedAgent,
  resolvedUris: readonly string[],
): RenderedAgent {
  if (resolvedUris.length === 0) return rendered;

  if (rendered.format === "json") {
    const data = clone(rendered.data);
    const existing = Array.isArray(data.resources)
      ? [...(data.resources as string[])]
      : [];
    for (const uri of resolvedUris) {
      if (!existing.includes(uri)) existing.push(uri);
    }
    data.resources = existing.sort();
    return { ...rendered, data };
  }

  // markdown-frontmatter: no conventions registered for these platforms in v1.
  return rendered;
}
