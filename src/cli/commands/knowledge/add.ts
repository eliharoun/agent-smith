import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import pc from "picocolors";
import { parseConfig } from "../../../core/config-schema";
import { type AtlassianAuth, resolveAtlassianAuth } from "../../../io/atlassian-auth";
import { findRoute } from "../../../core/knowledge/routing-registry";
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
import type { McpClientOpts } from "../../../io/mcp-client";
import { McpClientPool } from "../../../io/mcp-client-pool";
import { type AvailableMap, readAvailableMcpServers } from "../../../io/mcp-config-readers";
import { createSpawnOptsResolver } from "../../../io/mcp-spawn-resolver";
import { readToken } from "../../prompt";
import { pickViaInteractively } from "./pick-via";

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
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || fallback
  );
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
  /** v1.2 DI: prompt user for confirmation. Returns "y" / "n" / "". */
  prompt?: (msg: string) => Promise<string>;
  /** v1.2 DI: whether stdin is a TTY (drives auto-confirm vs print-only). */
  isTTY?: () => boolean;
  /** v1.4 DI: read user's AI client MCP configs. Tests inject a stub map
   *  to avoid touching the real ~/.claude.json, ~/.codex/config.toml, etc.
   *  When unset, smith reads the real configs at $HOME. */
  readAvailableMcpServers?: () => Promise<AvailableMap>;
  /** v1.4 DI: build a spawn-opts resolver from the available map. Tests
   *  inject a stub that returns canned opts; the production path uses
   *  createSpawnOptsResolver against the same homeDir. */
  spawnOptsFor?: (server: string) => McpClientOpts;
  /** v1.4 DI: MCP client pool for the interactive picker. The picker uses
   *  it to call tools/list on the chosen server. When unset, smith
   *  constructs and shuts down its own pool around the picker call so
   *  spawned processes don't leak past the add command. */
  pool?: McpClientPool;
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

  // v1.4: interactive MCP server/tool picker. Before falling back to the
  // curated-registry suggestion path, ask the user "which of your declared
  // MCP servers should fetch this URL?". Servers come from BOTH the
  // bundle's mcpServers[] and the user's local AI client configs. When the
  // chosen server isn't already declared in the bundle, smith appends it
  // and the install pipeline will pick it up on the next materialize. The
  // picker is skipped entirely in non-TTY runs (cron, CI, daemon) so
  // unattended workloads never block on stdin.
  //
  // Defaults wired here (not at every CLI callsite) so any new caller of
  // knowledgeAdd in the future inherits the picker for free. Tests inject
  // their own prompt/isTTY pair and bypass these defaults entirely. In
  // non-TTY runs (CI, daemon, piped input), the default `isTTY()` returns
  // false and both the picker AND the curated-registry suggestion skip,
  // preserving the unattended-workload contract.
  const prompt = opts.prompt ?? readToken;
  const isTTY = opts.isTTY ?? (() => Boolean(process.stdin.isTTY));
  let chosenVia: { server: string; tool: string } | undefined;
  let chosenServerToAdd: string | undefined;
  const isTty = isTTY();
  const isHttpUrl = (s: string): boolean => {
    try {
      const u = new URL(s);
      return u.protocol === "http:" || u.protocol === "https:";
    } catch {
      return false;
    }
  };
  if (opts.type === "url" && isHttpUrl(opts.pathOrUrl) && isTty) {
    // Build the union of bundle-declared and locally-available MCP
    // servers. When both are empty there is nothing to pick from — fall
    // through to the curated-registry suggestion without printing the
    // picker UI.
    const declared = ((cfg.mcpServers as string[] | undefined) ?? []).slice();
    const readAvail =
      opts.readAvailableMcpServers ?? (() => readAvailableMcpServers({ homeDir: homedir() }));
    const available = await readAvail();
    if (declared.length > 0 || Object.keys(available).length > 0) {
      // Pool lifetime: when the caller injects a pool, the caller owns
      // shutdown (production wires the install pool through). When the
      // picker runs standalone (the common case for `knowledge add`), it
      // creates and shuts down its own pool inside this block so a
      // partway failure of the larger add does not leak server processes.
      const ownsPool = !opts.pool;
      const pool = opts.pool ?? new McpClientPool();
      const spawnOptsFor =
        opts.spawnOptsFor ?? (await createSpawnOptsResolver({ homeDir: homedir() }));
      try {
        const picked = await pickViaInteractively({
          url: opts.pathOrUrl,
          currentMcpServers: declared,
          availableMcpServers: available,
          pool,
          spawnOptsFor,
          prompt,
        });
        if (picked) {
          chosenVia = { server: picked.server, tool: picked.tool };
          if (picked.serverWasAdded) {
            chosenServerToAdd = picked.server;
          }
        }
      } finally {
        if (ownsPool) await pool.shutdown();
      }
    }
  }

  // v1.2: routing-registry suggestion for type=url sources. The registry
  // is suggestion-only: smith never auto-sets via without explicit user
  // confirmation. Reasoning: real upstream MCP tool names vary by server
  // distribution; auto-setting would silently produce -32601 method-not-
  // found errors against real servers. Author confirmation forces the
  // human to verify against their actual server's tools/list.
  // The curated registry now runs ONLY when the picker didn't land a
  // route (skipped in non-TTY mode, or user chose 0).
  let suggestedVia: { server: string; tool: string } | undefined;
  if (!chosenVia && opts.type === "url") {
    const route = findRoute(opts.pathOrUrl);
    if (route) {
      const note = (route as { note?: string }).note;
      console.log(pc.dim("•"), `URL matches a known pattern. Smith can route fetches through:`);
      console.log(`    ${pc.cyan(`${route.server}.${route.tool}`)}`);
      if (note) console.log(pc.dim(`    note: ${note}`));
      console.log(pc.dim(`    (verify the tool name against your server's tools/list)`));

      if (isTty) {
        const answer = (await prompt(`  use this routing? [y/N] `)).trim().toLowerCase();
        if (answer === "y" || answer === "yes") {
          suggestedVia = { server: route.server, tool: route.tool };
          console.log(pc.green("→"), `routing through ${route.server}.${route.tool}`);
        } else {
          console.log(pc.dim("  saving as direct-HTTP URL source (no routing)"));
        }
      } else {
        console.log(pc.dim("  non-interactive: saving without routing. To opt in, edit"));
        console.log(pc.dim(`  agent.config.json and add via: { server, tool } to source ${id}.`));
      }
    }
  }

  const newSource = constructSource(opts, id);

  // Apply routing decision (picker wins over curated-registry suggestion).
  if (chosenVia) {
    (newSource as unknown as Record<string, unknown>).via = chosenVia;
  } else if (suggestedVia) {
    (newSource as unknown as Record<string, unknown>).via = suggestedVia;
  }

  // Auto-extend mcpServers[] when the picker chose a server the bundle
  // hadn't declared yet. The install pipeline reads this list on the next
  // materialize so the picked server's tool is callable. The same name
  // also lands in cfg.mcp.required[] — recipients of the bundle should
  // refuse to install when a server they explicitly picked isn't present
  // in the recipient's MCP config (mirrors package.json:dependencies).
  if (chosenServerToAdd) {
    const existing = ((cfg.mcpServers as string[] | undefined) ?? []).slice();
    let addedToServers = false;
    if (!existing.includes(chosenServerToAdd)) {
      existing.push(chosenServerToAdd);
      cfg.mcpServers = existing;
      addedToServers = true;
    }
    const mcpBlock =
      cfg.mcp && typeof cfg.mcp === "object" && !Array.isArray(cfg.mcp)
        ? (cfg.mcp as { required?: string[]; peer?: string[] })
        : {};
    const required = (mcpBlock.required ?? []).slice();
    let addedToRequired = false;
    if (!required.includes(chosenServerToAdd)) {
      required.push(chosenServerToAdd);
      addedToRequired = true;
    }
    cfg.mcp = { ...mcpBlock, required };
    if (addedToServers || addedToRequired) {
      console.log(
        pc.green("→"),
        `added ${chosenServerToAdd} to mcpServers[] and marked as required`,
      );
    }
  }

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
