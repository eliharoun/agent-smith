import { readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import pc from "picocolors";
import { parseConfig } from "../../../core/config-schema";
import { type AtlassianAuth, resolveAtlassianAuth } from "../../../io/atlassian-auth";
import type {
  ConfluenceFormat,
  ConfluencePageRef,
  KnowledgeBlock,
  KnowledgeDelivery,
  KnowledgeSource,
  KnowledgeSourceType,
} from "../../../core/knowledge/types";
import { validateKnowledge } from "../../../core/knowledge/validator";
import { SmithError } from "../../../core/smith-error";
import { toMessage } from "../../../core/to-message";

/**
 * Parse a comma-separated Confluence page list into refs.
 * Segments matching `id:<positive integer>` become `{ id }`; everything else
 * (including malformed `id:` forms like `id:0`, `id:-5`, `id:abc`, `id:`) is
 * preserved as a literal title string. Empty segments are dropped.
 */
export function parsePagesList(input: string): ConfluencePageRef[] {
  const out: ConfluencePageRef[] = [];
  for (const raw of input.split(",")) {
    const seg = raw.trim();
    if (seg === "") continue;
    const m = /^id:(\d+)$/.exec(seg);
    if (m) {
      const n = Number(m[1]);
      if (Number.isInteger(n) && n > 0) {
        out.push({ id: n });
        continue;
      }
    }
    out.push(seg);
  }
  return out;
}

/**
 * Parse a comma-separated field list. Trims each segment and drops empties.
 * Does NOT special-case sentinel values like `*all` — they pass through as-is.
 */
export function parseFieldsList(input: string): string[] {
  const out: string[] = [];
  for (const raw of input.split(",")) {
    const seg = raw.trim();
    if (seg === "") continue;
    out.push(seg);
  }
  return out;
}

function slugify(s: string, fallback = ""): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || fallback;
}

function truncateSlug(s: string, max = 60): string {
  return s.slice(0, max).replace(/-+$/, "");
}

/**
 * URL-mode id derivation for Confluence pages and blog posts.
 * - Returns `<spaceSlug>-<slugify(title)>` when title is present and not
 *   already taken.
 * - Returns `<spaceSlug>-<slugify(title)>-<numericId>` on collision,
 *   trimming the title portion first so the disambiguating numeric
 *   suffix is never sliced off by the 60-char cap.
 * - Falls back to `<spaceSlug>-<numericId>` when title is null/empty,
 *   slugifies to empty, or when spaceSlug alone leaves no room for a
 *   title segment.
 */
export function deriveIdFromTitle(
  spaceSlug: string,
  title: string | null,
  numericId: number,
  existingIds: readonly string[],
): string {
  const titleSlug = title ? slugify(title) : "";
  const numericFallback = (): string => {
    const suffix = `-${numericId}`;
    if (spaceSlug.length + suffix.length <= 60) {
      return `${spaceSlug}${suffix}`;
    }
    // Pathological: spaceSlug eats the whole budget. Trim it so the
    // numeric id (the only true unique identifier) survives.
    const spaceRoom = Math.max(1, 60 - suffix.length);
    return `${spaceSlug.slice(0, spaceRoom).replace(/-+$/, "")}${suffix}`;
  };
  if (!titleSlug) {
    return numericFallback();
  }
  // If spaceSlug is so long that no title segment could survive
  // truncation alongside a disambiguating numeric suffix, skip straight
  // to the numeric fallback — the title would be silently dropped
  // otherwise, leaving an ambiguous id.
  const suffix = `-${numericId}`;
  const room = 60 - spaceSlug.length - 1 - suffix.length;
  if (room <= 0) {
    return numericFallback();
  }
  const candidate = truncateSlug(`${spaceSlug}-${titleSlug}`);
  if (!existingIds.includes(candidate)) return candidate;
  // Collision: reserve room for the `-<numericId>` suffix so truncation
  // can't silently drop it (which would re-collide with `candidate`).
  const trimmedTitle = titleSlug.slice(0, room).replace(/-+$/, "");
  return truncateSlug(`${spaceSlug}-${trimmedTitle}${suffix}`);
}

export interface KnowledgeAddOptions {
  bundleDir: string;
  type: KnowledgeSourceType;
  pathOrUrl: string;
  id?: string;
  delivery?: KnowledgeDelivery;
  description?: string;
  optional?: boolean;
  /** Agent name — required to auto-materialize. CLI passes this; programmatic callers may omit. */
  agentName?: string;
  /** Default true. Set false for `--no-install`. No-op when agentName/runInstall absent. */
  installAfter?: boolean;
  /** DI seam for the post-add install. CLI wiring injects `install({ name })`. */
  runInstall?: (agentName: string) => Promise<number>;
  // --- Confluence-only ---
  /** Raw `--pages` flag value (comma-separated). Parsed via parsePagesList. */
  pages?: string;
  /** Confluence: page count cap (schema: 1-100). */
  maxPages?: number;
  /** Confluence: recurse into child pages. */
  includeChildren?: boolean;
  /** Confluence: body format. */
  format?: ConfluenceFormat;
  // --- Jira-only ---
  /** Raw `--fields` flag value (comma-separated). Parsed via parseFieldsList. */
  fields?: string;
  /** Jira: result count cap (schema: 1-500). */
  maxResults?: number;
  // --- DI for auth probe (Task 5) ---
  /** Test override for the atlassian-auth resolver. */
  resolveAuth?: () => AtlassianAuth | null;
  /**
   * URL-mode signal from the CLI. When set, success-message format
   * includes the human label and (for confluence-page/blog) id
   * derivation uses deriveIdFromTitle instead of the standard deriveId.
   */
  urlMode?: {
    /** Human label for the success message, e.g. "Confluence page". */
    label: string;
    /** When present, triggers title-based id derivation for confluence. */
    titleId?: { title: string | null; numericId: number };
  };
}

function deriveId(opts: KnowledgeAddOptions): string {
  if (opts.id) return opts.id;
  if (opts.type === "url" || opts.type === "git") {
    try {
      const u = new URL(opts.pathOrUrl);
      const base = `${u.host}${u.pathname}`.replace(/\.git$/, "");
      return truncateSlug(slugify(base, "url-source"));
    } catch {
      return "url-source";
    }
  }
  if (opts.type === "confluence") {
    const spaceSlug = slugify(opts.pathOrUrl, "confluence-source");
    if (opts.pages) {
      const parsed = parsePagesList(opts.pages);
      const first = parsed[0];
      if (parsed.length === 1 && typeof first === "string") {
        const pageSlug = slugify(first);
        if (pageSlug) {
          return truncateSlug(`${spaceSlug}-${pageSlug}`);
        }
      }
    }
    return truncateSlug(spaceSlug);
  }
  if (opts.type === "jira") {
    return truncateSlug(slugify(opts.pathOrUrl.replace(/['"]/g, ""), "jira-source"));
  }
  // file/dir/glob: filename minus extension, kebab.
  const name = basename(opts.pathOrUrl).replace(/\.[^.]+$/, "");
  return slugify(name, "source");
}

function constructSource(opts: KnowledgeAddOptions, id: string): KnowledgeSource {
  const delivery = opts.delivery ?? "auto";
  const description = opts.description ? { description: opts.description } : {};
  const optional = opts.optional ? { optional: true } : {};
  switch (opts.type) {
    case "file":
      return { id, type: "file", delivery, path: opts.pathOrUrl, ...description, ...optional };
    case "dir":
      return { id, type: "dir", delivery, path: opts.pathOrUrl, ...description, ...optional };
    case "glob":
      return { id, type: "glob", delivery, path: opts.pathOrUrl, ...description, ...optional };
    case "url":
      return { id, type: "url", delivery, url: opts.pathOrUrl, ...description, ...optional };
    case "git":
      return { id, type: "git", delivery, url: opts.pathOrUrl, ...description, ...optional };
    case "npm":
      return { id, type: "npm", delivery, package: opts.pathOrUrl, ...description, ...optional };
    case "confluence": {
      const pages = opts.pages ? parsePagesList(opts.pages) : undefined;
      return {
        id,
        type: "confluence",
        delivery,
        space: opts.pathOrUrl,
        ...(pages && pages.length > 0 ? { pages } : {}),
        ...(opts.maxPages !== undefined ? { maxPages: opts.maxPages } : {}),
        ...(opts.includeChildren ? { includeChildren: true } : {}),
        ...(opts.format ? { format: opts.format } : {}),
        ...description,
        ...optional,
      };
    }
    case "jira": {
      const fields = opts.fields ? parseFieldsList(opts.fields) : undefined;
      return {
        id,
        type: "jira",
        delivery,
        jql: opts.pathOrUrl,
        ...(fields && fields.length > 0 ? { fields } : {}),
        ...(opts.maxResults !== undefined ? { maxResults: opts.maxResults } : {}),
        ...description,
        ...optional,
      };
    }
  }
}

export async function knowledgeAdd(opts: KnowledgeAddOptions): Promise<number> {
  const cfgPath = join(opts.bundleDir, "agent.config.json");
  let raw: string;
  try {
    raw = await readFile(cfgPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new SmithError(
        {
          code: "config-missing",
          path: cfgPath,
          suggestedCommand: `smith agent init ${basename(opts.bundleDir)}`,
        },
        { cause: err },
      );
    }
    throw err;
  }
  let cfg: Record<string, unknown>;
  try {
    cfg = JSON.parse(raw) as Record<string, unknown>;
  } catch (err) {
    throw new SmithError(
      {
        code: "validation-failed",
        what: "agent.config.json",
        reasons: [`${cfgPath}: ${toMessage(err)}`],
      },
      { cause: err },
    );
  }

  // URL-mode id derivation: when the CLI signals URL mode AND we have a
  // title/numericId pair (confluence-page or confluence-blog), use the
  // title-with-collision-suffix strategy. Explicit --id still wins.
  let id: string;
  if (opts.id) {
    id = opts.id;
  } else if (opts.urlMode?.titleId && opts.type === "confluence") {
    const existingBlock = (cfg.knowledge as KnowledgeBlock | undefined) ?? {};
    const existingIds = (existingBlock.sources ?? []).map((s) => s.id);
    const spaceSlug = slugify(opts.pathOrUrl, "confluence-source");
    id = deriveIdFromTitle(
      spaceSlug,
      opts.urlMode.titleId.title,
      opts.urlMode.titleId.numericId,
      existingIds,
    );
  } else {
    id = deriveId(opts);
  }
  const newSource = constructSource(opts, id);

  // Atlassian-auth presence check for confluence/jira sources.
  // Probes env vars + the agent-smith .env file (no network). On miss,
  // emit a yellow warn — DO NOT block the add. The user may set creds
  // later; if they let auto-materialize run anyway, `smith agent install`
  // surfaces the proper remediation error from the pipeline.
  if (opts.type === "confluence" || opts.type === "jira") {
    const resolve = opts.resolveAuth ?? resolveAtlassianAuth;
    if (resolve() === null) {
      console.log(
        pc.yellow("warn"),
        "Atlassian auth not configured. Materialize will fail without SMITH_ATLASSIAN_EMAIL + SMITH_ATLASSIAN_API_TOKEN.",
      );
    }
  }

  const block: KnowledgeBlock = (cfg.knowledge as KnowledgeBlock) ?? {};
  const sources = [...(block.sources ?? []), newSource];
  cfg.knowledge = { ...block, sources };

  const parsed = parseConfig(cfg);
  if (!parsed.success) {
    throw new SmithError({
      code: "validation-failed",
      what: "agent config (after knowledge add)",
      reasons: parsed.errors,
    });
  }
  const k = validateKnowledge(cfg.knowledge as KnowledgeBlock | undefined);
  if (k.errors.length > 0) {
    throw new SmithError({
      code: "validation-failed",
      what: "knowledge block (after add)",
      reasons: k.errors,
    });
  }
  for (const w of k.warnings) console.log(pc.yellow("warn"), w);

  await writeFile(cfgPath, `${JSON.stringify(cfg, null, 2)}\n`, "utf8");
  const labelPrefix = opts.urlMode ? `${opts.urlMode.label} ` : "";
  console.log(pc.green("→"), `added ${labelPrefix}knowledge source ${id} (${opts.type})`);

  const shouldInstall =
    opts.installAfter !== false && Boolean(opts.agentName) && Boolean(opts.runInstall);
  if (!shouldInstall) {
    if (opts.agentName) {
      console.log(pc.dim(`  run 'smith agent install ${opts.agentName}' to materialize`));
    } else {
      console.log(pc.dim("  run 'smith agent install <agent>' to materialize"));
    }
    return 0;
  }

  const agent = opts.agentName as string;
  const runInstall = opts.runInstall as (n: string) => Promise<number>;
  console.log(pc.dim(`  materializing via 'smith agent install ${agent}'…`));
  try {
    const code = await runInstall(agent);
    if (code !== 0) {
      console.log(
        pc.yellow("warn"),
        `materialize exited with code ${code}. Retry: smith agent install ${agent}`,
      );
    }
  } catch (err) {
    console.log(
      pc.yellow("warn"),
      `materialize failed: ${toMessage(err)}. Source was saved. Retry: smith agent install ${agent}`,
    );
  }
  return 0;
}
