import type { KnowledgeSource, Platform } from "gui-shared";
import { useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "@/api/client";
import { useSaveAgentConfig } from "@/hooks/useAgents";
import { Button } from "@/ui/Button";
import { ConfirmModal } from "@/ui/ConfirmModal";
import { FieldHelp } from "@/ui/FieldHelp";
import { FormField } from "@/ui/FormField";
import { Toggle } from "@/ui/Toggle";
import { Tooltip } from "@/ui/Tooltip";
import { RoutingPicker, type ViaPick } from "./sourceForms/RoutingPicker";
import { StaleArtifactsConfirmModal } from "./StaleArtifactsConfirmModal";
import { useSaveSuccessNotification } from "./useSaveSuccessNotification";

/**
 * Per-source editor for ALL v1+v2 knowledge source fields. The Add flow
 * (`AddKnowledgeSourceModal`) goes through `smith knowledge add` to create a
 * source with a minimal payload; this editor instead writes the canonical
 * `agent.config.json#knowledge` block via `PUT /api/agents/:name/config`,
 * which lets us round-trip every field surfaced by the canonical schema:
 *   v1: materialize, extractor, refresh.{mode,ttl,timeout}, optional,
 *       inlineBudgetTokens, description
 *   v2: delivery, summary, toc, retrieval.{mode,mcpUrl}
 *
 * The modal pre-populates from `existingSource`, replaces that source by id
 * in the full `knowledge.sources` array (PRESERVING all other sources and
 * `knowledge.{packs,inlineBudget,compile}`), and PUTs the entire knowledge
 * block. The server re-validates against the canonical schema before
 * writing.
 */

type SourceType = KnowledgeSource["type"];

type Delivery = "auto" | "inline" | "file";
type RetrievalMode = "off" | "bm25" | "external-mcp";
type RefreshMode = "install" | "ttl" | "session" | "always";
type Materialize = "markdown" | "text" | "html-to-md" | "json" | "passthrough";
type Extractor = "pdf-parse" | "mupdf";

// Mirrors STATIC_TYPES in src/core/knowledge/refresh-spec.ts. Static types
// (local file/dir/glob/npm) cannot be live-refreshed because there's nothing
// to re-fetch — they're read from disk on each install. Only `install` mode
// (default; refresh at install time only) is permitted.
const STATIC_TYPES = ["file", "dir", "glob", "npm"] as const;

function isStaticType(type: string): boolean {
  return (STATIC_TYPES as readonly string[]).includes(type);
}

// Mirror of `lazyDescriptionWarnings()` in src/core/knowledge/lazy-url.ts —
// inlined because the GUI cannot cross-import CLI code (rootDir boundary).
// Constants kept in lockstep with that file. Returns user-facing strings, one
// per detected issue, suitable for inline rendering near the description
// field. An empty list means the description is fine.
const LAZY_DESC_MIN = 30;
const LAZY_DESC_MAX = 1024;
const LAZY_FIRST_OR_SECOND_PERSON =
  /^(I |I'|you |you'|this skill|this source|this knowledge)/i;

function lazyDescriptionWarnings(description: string): string[] {
  const warnings: string[] = [];
  const desc = description ?? "";
  if (desc.trim().length === 0) {
    warnings.push(
      "lazy URL sources should have a description — it's the agent's only signal until it fetches the URL",
    );
    return warnings;
  }
  if (desc.trim().length < LAZY_DESC_MIN) {
    warnings.push(
      `description is shorter than ${LAZY_DESC_MIN} chars — write what the source contains and when to use it`,
    );
  }
  if (LAZY_FIRST_OR_SECOND_PERSON.test(desc.trim())) {
    warnings.push(
      'description should be written in third person (e.g. "Documents X. Use when Y.") — first/second person reduces tool-discovery accuracy',
    );
  }
  if (desc.length > LAZY_DESC_MAX) {
    warnings.push(
      `description is longer than ${LAZY_DESC_MAX} chars — agent runtimes may truncate; trim trigger keywords up front`,
    );
  }
  return warnings;
}

// Default reinstall used when no callback is provided. Real callers wire
// this through from the parent panel's `useReinstall` so the post-save
// toast's "Re-install now" action drives the same flow as the agent
// page's Re-install button.
function noopReinstall(_targets: Platform[]): void {
  void _targets;
}

interface KnowledgeBlock {
  packs?: string[];
  inlineBudget?: { totalTokens: number };
  sources?: KnowledgeSource[];
  compile?: Record<string, unknown>;
}

interface Props {
  agent: string;
  existingSource: KnowledgeSource;
  /** The full knowledge block from agent.config.knowledge — used to round-trip every other field. */
  knowledgeBlock: KnowledgeBlock;
  /**
   * The agent's currently-declared `mcpServers[]`. Surfaced to the routing
   * picker so it can flag pre-selected `via.server` values that aren't
   * actually wired into the bundle. Defaults to [] when unknown — that case
   * still works (the picker just shows the ghost server with `[not in
   * available servers]` instead of `[not configured]`).
   */
  mcpServers?: ReadonlyArray<string>;
  /**
   * Re-install dispatcher used by the save-success notification's
   * "Re-install now" action when the just-saved change leaves at least one
   * installed platform with drifted on-disk render. Lifted into the parent
   * so the hook instance owning the progress→success notification lifecycle
   * survives this modal's unmount on save. Optional in tests that don't
   * exercise the post-save toast path; the parent always wires it.
   */
  reinstall?: (targets: Platform[]) => void;
  onClose: () => void;
}

interface DraftState {
  // type-specific (string fields only — number/array fields kept as strings until commit)
  path: string;
  url: string;
  pkg: string;
  space: string;
  jql: string;
  ref: string;
  subpath: string;
  includeStr: string; // newline-separated for dir/git/web(crawl)
  excludeStr: string; // newline-separated for dir/web(crawl)
  fieldsStr: string; // comma-separated for jira
  pagesStr: string; // newline-separated for confluence
  maxPages: string;
  maxResults: string;
  includeChildren: boolean;
  format: "" | "storage" | "view" | "markdown";
  auth: "" | "atlassian" | "none";
  // web-specific
  mode: "" | "crawl" | "llms-txt" | "openapi";
  depth: string;
  sameOrigin: boolean;
  // mcp-specific
  server: string;
  tool: string;
  argsStr: string; // newline k=v lines
  preset: string;
  allowWriteTool: boolean;
  // common v1
  description: string;
  optional: boolean;
  materialize: "" | Materialize;
  extractor: "" | Extractor;
  inlineBudgetTokens: string;
  refreshMode: "" | RefreshMode;
  refreshTtl: string;
  refreshTimeout: string;
  // v2
  delivery: Delivery;
  summary: string;
  toc: "default" | "yes" | "no";
  retrievalMode: RetrievalMode;
  retrievalMcpUrl: string;
  /**
   * Routing pick (URL/webpage sources only). null means "direct HTTP — no via:".
   * Initialized from `existingSource.via` so the picker shows the current
   * route pre-selected; updated by the picker's onChange. On save, when set,
   * `via:` is written; when null, the field is omitted entirely (the schema
   * rejects `via: null`).
   */
  via: ViaPick | null;
  /**
   * Lazy URL fetch (URL/webpage sources only). When true, smith does not fetch at
   * install time — the bundle ships only the URL + description and the agent
   * fetches at runtime. The four conflict fields (delivery, materialize,
   * extractor, inlineBudgetTokens) are dropped on save; their typed values
   * stay in the draft so toggle-back recovers them.
   */
  lazy: boolean;
}

interface InitialDraft {
  draft: DraftState;
  /** True when the loaded source has a refresh.mode that's invalid for its
   *  type (e.g., a static type with mode != "install"). The editor shows a
   *  warning and the in-memory state is auto-reset to "install" so saving
   *  writes the corrected value. */
  invalidRefreshMode?: { type: SourceType; loadedMode: RefreshMode };
}

function initialDraft(s: KnowledgeSource): InitialDraft {
  // Helpers — narrow the union without losing strict-mode safety.
  const anySrc = s as Record<string, unknown>;
  const refreshObj =
    typeof anySrc.refresh === "object" && anySrc.refresh !== null
      ? (anySrc.refresh as { mode?: RefreshMode; ttl?: string; timeout?: number })
      : undefined;
  const refreshStr = typeof anySrc.refresh === "string" ? (anySrc.refresh as string) : undefined;
  const retrieval =
    typeof anySrc.retrieval === "object" && anySrc.retrieval !== null
      ? (anySrc.retrieval as { mode?: RetrievalMode; mcpUrl?: string })
      : undefined;
  // Detect static type with invalid loaded refresh.mode (e.g., hand-edited
  // config that bypassed validation). Reset to "install" and surface a warning.
  let invalidRefreshMode: InitialDraft["invalidRefreshMode"];
  let resolvedRefreshMode: "" | RefreshMode = refreshObj?.mode ?? (refreshStr ? "" : "");
  if (
    isStaticType(s.type) &&
    resolvedRefreshMode !== "" &&
    resolvedRefreshMode !== "install"
  ) {
    invalidRefreshMode = { type: s.type, loadedMode: resolvedRefreshMode };
    resolvedRefreshMode = "install";
  }
  const draft: DraftState = {
    path: s.type === "file" || s.type === "dir" || s.type === "glob" ? (s.path as string) : "",
    url: s.type === "url" || s.type === "webpage" || s.type === "git" || s.type === "web" ? (s.url as string) : "",
    pkg: s.type === "npm" ? (s.package as string) : "",
    space: s.type === "confluence" ? (s.space as string) : "",
    jql: s.type === "jira" ? (s.jql as string) : "",
    ref: s.type === "git" && s.ref ? s.ref : "",
    subpath: s.type === "git" && s.subpath ? s.subpath : "",
    includeStr: (() => {
      if ((s.type === "dir" || s.type === "git") && s.include) return s.include.join("\n");
      if (s.type === "web" && s.include) return s.include.join("\n");
      return "";
    })(),
    excludeStr: (() => {
      if (s.type === "dir" && s.exclude) return s.exclude.join("\n");
      if (s.type === "web" && s.exclude) return s.exclude.join("\n");
      return "";
    })(),
    fieldsStr: s.type === "jira" && s.fields ? s.fields.join(", ") : "",
    pagesStr:
      s.type === "confluence" && s.pages
        ? s.pages.map((p) => (typeof p === "string" ? p : `id:${p.id}`)).join("\n")
        : "",
    maxPages: (() => {
      if (s.type === "confluence" && s.maxPages != null) return String(s.maxPages);
      if (s.type === "web" && s.maxPages != null) return String(s.maxPages);
      return "";
    })(),
    maxResults: s.type === "jira" && s.maxResults != null ? String(s.maxResults) : "",
    includeChildren: s.type === "confluence" && s.includeChildren === true,
    format: s.type === "confluence" && s.format ? s.format : "",
    auth: (s.type === "url" || s.type === "webpage") && s.auth ? s.auth : "",
    // web-specific
    mode: s.type === "web" ? s.mode : "",
    depth: s.type === "web" && s.depth != null ? String(s.depth) : "",
    sameOrigin: s.type === "web" ? s.sameOrigin !== false : true,
    // mcp-specific
    server: s.type === "mcp" ? s.server : "",
    tool: s.type === "mcp" ? s.tool : "",
    argsStr: s.type === "mcp" && s.args
      ? Object.entries(s.args).map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`).join("\n")
      : "",
    preset: s.type === "mcp" && s.preset ? s.preset : "",
    allowWriteTool: s.type === "mcp" && s.allowWriteTool === true,
    description: s.description ?? "",
    optional: s.optional === true,
    materialize:
      s.materialize && s.materialize !== "pdf-extract" ? (s.materialize as Materialize) : "",
    extractor: s.extractor ?? "",
    inlineBudgetTokens: s.inlineBudgetTokens != null ? String(s.inlineBudgetTokens) : "",
    refreshMode: resolvedRefreshMode,
    refreshTtl: refreshObj?.ttl ?? "",
    refreshTimeout: refreshObj?.timeout != null ? String(refreshObj.timeout) : "",
    delivery: (s.delivery as Delivery | undefined) ?? "auto",
    summary: (anySrc.summary as string | undefined) ?? "",
    toc:
      (anySrc.toc as boolean | undefined) === undefined
        ? "default"
        : anySrc.toc === false
          ? "no"
          : "yes",
    retrievalMode: retrieval?.mode ?? "bm25",
    retrievalMcpUrl: retrieval?.mcpUrl ?? "",
    via: (() => {
      // Only URL/webpage sources route via MCP. Defensively narrow other types to
      // null even if the loaded JSON happens to carry a `via` key (it
      // wouldn't pass the canonical schema, but the editor never crashes).
      if (s.type !== "url" && s.type !== "webpage") return null;
      const v = anySrc.via;
      if (
        v &&
        typeof v === "object" &&
        typeof (v as { server?: unknown }).server === "string" &&
        typeof (v as { tool?: unknown }).tool === "string"
      ) {
        const server = (v as { server: string }).server;
        const tool = (v as { tool: string }).tool;
        return { server, tool } as ViaPick;
      }
      return null;
    })(),
    lazy: anySrc.lazy === true,
  };
  return invalidRefreshMode ? { draft, invalidRefreshMode } : { draft };
}

function validateDraft(draft: DraftState, type: SourceType): Record<string, string> {
  const errors: Record<string, string> = {};
  // type-specific required fields
  if ((type === "file" || type === "dir" || type === "glob") && !draft.path.trim()) {
    errors.path = "required";
  }
  if ((type === "url" || type === "webpage" || type === "git" || type === "web") && !draft.url.trim()) {
    errors.url = "required";
  }
  if (type === "npm" && !draft.pkg.trim()) errors.pkg = "required";
  if (type === "confluence" && !draft.space.trim()) errors.space = "required";
  if (type === "jira" && !draft.jql.trim()) errors.jql = "required";
  // web: mode required
  if (type === "web" && !draft.mode) errors.mode = "required";
  // web: depth 1-5
  if (type === "web" && draft.depth) {
    const n = Number(draft.depth);
    if (!Number.isInteger(n) || n < 1 || n > 5) errors.depth = "1–5";
  }
  // mcp: server + tool required
  if (type === "mcp" && !draft.server.trim()) errors.server = "required";
  if (type === "mcp" && !draft.tool.trim()) errors.tool = "required";
  // mcp: reject credential-shaped args keys + malformed lines
  if (type === "mcp" && draft.argsStr.trim()) {
    const credentialRe = /(authorization|bearer|cookie|credential|password|passwd|secret|token|(^|[_-])(api|access|private|secret)[_-]?key($|[_-])|apikey)/i;
    for (const line of draft.argsStr.split("\n").filter((l) => l.trim())) {
      if (!line.includes("=")) {
        errors.argsStr = "each line must be key=value";
        break;
      }
      const key = line.split("=")[0]!.trim();
      if (credentialRe.test(key)) {
        errors.argsStr = `"${key}" looks like a credential — use env vars instead`;
        break;
      }
    }
  }
  // refresh ttl validation when mode=ttl
  if (draft.refreshMode === "ttl") {
    if (!draft.refreshTtl) errors.refreshTtl = "required when mode=ttl";
    else if (!/^\d+(s|m|h|d|w)$/.test(draft.refreshTtl))
      errors.refreshTtl = "format: 30m, 2h, 1d, 1w";
  }
  if (draft.refreshTimeout) {
    const n = Number(draft.refreshTimeout);
    if (!Number.isInteger(n) || n < 1 || n > 60) errors.refreshTimeout = "1–60 seconds";
  }
  if (draft.inlineBudgetTokens) {
    const n = Number(draft.inlineBudgetTokens);
    if (!Number.isInteger(n) || n < 1 || n > 16000) errors.inlineBudgetTokens = "1–16000";
  }
  // retrieval external-mcp requires mcpUrl
  if (draft.retrievalMode === "external-mcp" && !draft.retrievalMcpUrl.trim()) {
    errors.retrievalMcpUrl = "required when mode=external-mcp";
  }
  if (draft.retrievalMcpUrl) {
    try {
      new URL(draft.retrievalMcpUrl);
    } catch {
      errors.retrievalMcpUrl = "must be a valid URL";
    }
  }
  // summary max 280 (canonical schema cap)
  if (draft.summary.length > 280) errors.summary = "max 280 characters";
  // maxPages / maxResults bounds — type-aware cap
  if (draft.maxPages) {
    const n = Number(draft.maxPages);
    const cap = type === "web" ? 200 : 100;
    if (!Number.isInteger(n) || n < 1 || n > cap) errors.maxPages = `1–${cap}`;
  }
  if (draft.maxResults) {
    const n = Number(draft.maxResults);
    if (!Number.isInteger(n) || n < 1 || n > 500) errors.maxResults = "1–500";
  }
  return errors;
}

/**
 * Build the canonical KnowledgeSource from the draft + the original source
 * (the original supplies `id` and `type`, both pinned). Strips empty-string
 * values so the JSON written to disk is clean (matches CLI authoring style).
 */
function buildSource(original: KnowledgeSource, draft: DraftState): KnowledgeSource {
  const base: Record<string, unknown> = { id: original.id, type: original.type };
  if (draft.delivery) base.delivery = draft.delivery;
  if (draft.description.trim()) base.description = draft.description.trim();
  if (draft.optional) base.optional = true;
  if (draft.materialize) base.materialize = draft.materialize;
  if (draft.extractor) base.extractor = draft.extractor;
  if (draft.inlineBudgetTokens) base.inlineBudgetTokens = Number(draft.inlineBudgetTokens);
  if (draft.refreshMode) {
    const refresh: Record<string, unknown> = { mode: draft.refreshMode };
    if (draft.refreshMode === "ttl" && draft.refreshTtl) refresh.ttl = draft.refreshTtl;
    if (draft.refreshTimeout) refresh.timeout = Number(draft.refreshTimeout);
    base.refresh = refresh;
  }
  if (draft.summary.trim()) base.summary = draft.summary.trim();
  if (draft.toc !== "default") base.toc = draft.toc === "yes";
  if (draft.retrievalMode !== "bm25") {
    const r: Record<string, unknown> = { mode: draft.retrievalMode };
    if (draft.retrievalMode === "external-mcp" && draft.retrievalMcpUrl.trim())
      r.mcpUrl = draft.retrievalMcpUrl.trim();
    base.retrieval = r;
  }

  // type-specific fields
  switch (original.type) {
    case "file":
    case "glob":
      base.path = draft.path.trim();
      break;
    case "dir": {
      base.path = draft.path.trim();
      const include = draft.includeStr
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      if (include.length) base.include = include;
      const exclude = draft.excludeStr
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      if (exclude.length) base.exclude = exclude;
      break;
    }
    case "url":
    case "webpage": {
      base.url = draft.url.trim();
      if (draft.auth) base.auth = draft.auth;
      break;
    }
    case "web": {
      base.url = draft.url.trim();
      base.mode = draft.mode;
      if (draft.mode === "crawl") {
        if (draft.maxPages) base.maxPages = Number(draft.maxPages);
        if (draft.depth) base.depth = Number(draft.depth);
        if (!draft.sameOrigin) base.sameOrigin = false;
        const include = draft.includeStr
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean);
        if (include.length) base.include = include;
        const exclude = draft.excludeStr
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean);
        if (exclude.length) base.exclude = exclude;
      }
      break;
    }
    case "mcp": {
      base.server = draft.server.trim();
      base.tool = draft.tool.trim();
      if (draft.argsStr.trim()) {
        const args: Record<string, unknown> = {};
        for (const line of draft.argsStr.split("\n").filter((l) => l.trim())) {
          const idx = line.indexOf("=");
          if (idx > 0) {
            const k = line.slice(0, idx).trim();
            const raw = line.slice(idx + 1);
            try {
              args[k] = JSON.parse(raw);
            } catch {
              args[k] = raw;
            }
          }
        }
        if (Object.keys(args).length) base.args = args;
      }
      if (draft.preset) base.preset = draft.preset;
      if (draft.allowWriteTool) base.allowWriteTool = true;
      break;
    }
    case "git": {
      base.url = draft.url.trim();
      if (draft.ref.trim()) base.ref = draft.ref.trim();
      if (draft.subpath.trim()) base.subpath = draft.subpath.trim();
      const include = draft.includeStr
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      if (include.length) base.include = include;
      break;
    }
    case "npm":
      base.package = draft.pkg.trim();
      break;
    case "confluence": {
      base.space = draft.space.trim();
      const pages = draft.pagesStr
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((line) => {
          if (line.startsWith("id:")) {
            const n = Number(line.slice(3));
            if (Number.isInteger(n) && n > 0) return { id: n };
          }
          return line;
        });
      if (pages.length) base.pages = pages;
      if (draft.maxPages) base.maxPages = Number(draft.maxPages);
      if (draft.includeChildren) base.includeChildren = true;
      if (draft.format) base.format = draft.format;
      break;
    }
    case "jira": {
      base.jql = draft.jql.trim();
      const fields = draft.fieldsStr
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (fields.length) base.fields = fields;
      if (draft.maxResults) base.maxResults = Number(draft.maxResults);
      break;
    }
  }

  // Routing (URL/webpage sources only). Edit-flow rule: write `via` when the picker
  // landed on a server+tool, omit entirely when null. Never write
  // `"via": null` — the canonical schema rejects unknown shapes there.
  if ((original.type === "url" || original.type === "webpage") && draft.via) {
    base.via = { server: draft.via.server, tool: draft.via.tool };
  }

  // Lazy URL: write `lazy: true` and DROP the four schema-forbidden fields
  // regardless of the typed-but-now-disabled draft values. Omit `lazy: false`
  // (clean JSON convention — the schema treats absent and false identically).
  if ((original.type === "url" || original.type === "webpage") && draft.lazy) {
    base.lazy = true;
    delete base.delivery;
    delete base.materialize;
    delete base.extractor;
    delete base.inlineBudgetTokens;
  }

  return base as unknown as KnowledgeSource;
}

export function EditKnowledgeSourceModal({
  agent,
  existingSource,
  knowledgeBlock,
  mcpServers,
  reinstall,
  onClose,
}: Props) {
  const initial = useMemo(() => initialDraft(existingSource), [existingSource]);
  const [draft, setDraft] = useState<DraftState>(initial.draft);
  const [advancedOpen, setAdvancedOpen] = useState(true);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [confirmStale, setConfirmStale] = useState(false);
  const save = useSaveAgentConfig(agent);
  const reinstallFn = reinstall ?? noopReinstall;
  const notifyAfterSave = useSaveSuccessNotification(agent, reinstallFn);
  const formId = "knowledge-edit-form";
  // When the loaded source has an invalid refresh.mode for its type, the
  // initial draft is auto-reset — the editor should treat that as dirty so
  // Save is enabled and the corrected value gets persisted.
  const dirty = useMemo(
    () =>
      JSON.stringify(draft) !== JSON.stringify(initial.draft) || !!initial.invalidRefreshMode,
    [draft, initial],
  );
  const errors = useMemo(
    () => validateDraft(draft, existingSource.type),
    [draft, existingSource.type],
  );
  const valid = Object.keys(errors).length === 0;

  // Esc to cancel (with dirty-confirm).
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (dirty) setConfirmDiscard(true);
        else closeRef.current();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [dirty]);

  function update<K extends keyof DraftState>(k: K, v: DraftState[K]) {
    setDraft((d) => ({ ...d, [k]: v }));
  }

  // True when the user is flipping non-lazy → lazy on this save. The save
  // path consults this to decide whether to cache-status-check + show the
  // 3-button confirm dialog.
  const flippingNonLazyToLazy =
    (existingSource.type === "url" || existingSource.type === "webpage") && draft.lazy && !initial.draft.lazy;

  function performSave() {
    const built = buildSource(existingSource, draft);
    const sources = (knowledgeBlock.sources ?? []).map((s) =>
      s.id === existingSource.id ? built : s,
    );
    const nextBlock: KnowledgeBlock = { ...knowledgeBlock, sources };
    const patch: Record<string, unknown> = {
      knowledge: nextBlock as unknown as Record<string, unknown>,
    };
    // mcpServers extension: when the user picked a server that the bundle
    // hasn't declared yet (e.g., one that surfaces from AI client config
    // only), append it so the install pipeline wires it up. Don't touch
    // mcp.required[] — that's the Add flow's concern; Edit only patches the
    // routing declaration the user just chose.
    if (
      (existingSource.type === "url" || existingSource.type === "webpage") &&
      draft.via?.server &&
      mcpServers !== undefined &&
      !mcpServers.includes(draft.via.server)
    ) {
      patch.mcpServers = [...mcpServers, draft.via.server];
    }
    save.mutate(patch as Parameters<typeof save.mutate>[0], {
      onSuccess: () => {
        // Fire the post-save notification BEFORE closing — the notify call
        // returns immediately after enqueueing into the
        // <NotificationCenter> context, but the drift-check apiFetch it
        // awaits internally must outlive this component, so the void here
        // is intentional. The notification (and its action closure) live in
        // the persistent NotificationCenter, not this modal.
        void notifyAfterSave("Saved");
        onClose();
      },
    });
  }

  async function deleteCacheThenSave() {
    try {
      await apiFetch(
        `/api/agents/${encodeURIComponent(agent)}/knowledge/sources/${encodeURIComponent(
          existingSource.id,
        )}/cache`,
        { method: "DELETE" },
      );
    } catch {
      // Cache deletion failure is non-fatal — the user's intent was to lazy-
      // ify the source, and the schema-side strip already happened in the
      // payload. Surface as a toast in a future task; for now, save anyway.
    }
    performSave();
  }

  function handleSubmit() {
    if (!valid || !dirty || save.isPending) return;
    if (!flippingNonLazyToLazy) {
      performSave();
      return;
    }
    // Flipping non-lazy → lazy: ask the server if there are cached
    // install-time artifacts, then either save directly (no cache) or open
    // the 3-button stale-artifacts confirm.
    void apiFetch<{ hasCachedFiles: boolean }>(
      `/api/agents/${encodeURIComponent(agent)}/knowledge/sources/${encodeURIComponent(
        existingSource.id,
      )}/cache-status`,
    )
      .then((r) => {
        if (r.hasCachedFiles) {
          setConfirmStale(true);
        } else {
          performSave();
        }
      })
      .catch(() => {
        // If the cache-status probe fails, save anyway — the schema-side
        // strip is what matters for correctness.
        performSave();
      });
  }

  function requestClose() {
    if (dirty) setConfirmDiscard(true);
    else onClose();
  }

  const t = existingSource.type;

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
        role="dialog"
        aria-modal="true"
        aria-label={`edit knowledge source ${existingSource.id}`}
      >
        <div className="border border-matrix-green bg-black p-6 w-full max-w-xl max-h-[90vh] overflow-y-auto">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-mono text-matrix-green uppercase tracking-widest text-sm">
              // edit source · {existingSource.id} ({t})
            </h2>
            <Button variant="ghost" onClick={requestClose} aria-label="close">
              ✕
            </Button>
          </div>

          <form
            id={formId}
            onSubmit={(e) => {
              e.preventDefault();
              handleSubmit();
            }}
            className="space-y-3"
          >
            {/* ─── Type-specific fields ──────────────────────────────── */}
            {(t === "file" || t === "dir" || t === "glob") && (
              <FormField
                label={t === "glob" ? "glob" : t === "dir" ? "directory" : "path"}
                fieldId="knowledge.path"
                required
                value={draft.path}
                onChange={(e) => update("path", e.target.value)}
                error={errors.path}
              />
            )}
            {t === "dir" && (
              <>
                <TextArea
                  label="include (one glob per line)"
                  fieldId="knowledge.include"
                  value={draft.includeStr}
                  onChange={(v) => update("includeStr", v)}
                />
                <TextArea
                  label="exclude (one glob per line)"
                  fieldId="knowledge.exclude"
                  value={draft.excludeStr}
                  onChange={(v) => update("excludeStr", v)}
                />
              </>
            )}
            {(t === "url" || t === "webpage" || t === "git" || t === "web") && (
              <FormField
                label={t === "git" ? "git url" : "url"}
                fieldId="knowledge.url"
                required
                value={draft.url}
                onChange={(e) => update("url", e.target.value)}
                error={errors.url}
              />
            )}
            {(t === "url" || t === "webpage") && (
              <RoutingPicker
                agent={agent}
                value={draft.via}
                onChange={(v) => update("via", v)}
                currentMcpServers={mcpServers ?? []}
              />
            )}
            {(t === "url" || t === "webpage") && (
              <Select
                label="auth"
                fieldId="knowledge.url.auth"
                value={draft.auth}
                onChange={(v) => update("auth", v as DraftState["auth"])}
                options={[
                  { v: "", l: "(none)" },
                  { v: "none", l: "none" },
                  { v: "atlassian", l: "atlassian" },
                ]}
              />
            )}
            {(t === "url" || t === "webpage") && (
              <div className="flex flex-col gap-1">
                <Toggle
                  aria-label="Lazy fetch"
                  label="lazy fetch"
                  checked={draft.lazy}
                  onChange={(v) => update("lazy", v)}
                />
                {draft.lazy && (
                  <>
                    <p className="font-mono text-[10px] text-matrix-green-muted">
                      // when lazy is on, the agent reads this description at runtime to
                      decide whether to fetch the URL — write what the source contains
                      and when to use it.
                    </p>
                    {lazyDescriptionWarnings(draft.description).map((w) => (
                      <p
                        key={w}
                        className="font-mono text-[10px] text-matrix-amber"
                        role="status"
                      >
                        // {w}
                      </p>
                    ))}
                  </>
                )}
              </div>
            )}
            {t === "web" && (
              <>
                <Select
                  label="mode"
                  fieldId="knowledge.web.mode"
                  value={draft.mode}
                  onChange={(v) => update("mode", v as DraftState["mode"])}
                  options={[
                    { v: "crawl", l: "crawl" },
                    { v: "llms-txt", l: "llms-txt" },
                    { v: "openapi", l: "openapi" },
                  ]}
                />
                {draft.mode === "crawl" && (
                  <>
                    <FormField
                      label="max pages"
                      fieldId="knowledge.web.maxPages"
                      type="number"
                      min={1}
                      max={200}
                      value={draft.maxPages}
                      onChange={(e) => update("maxPages", e.target.value)}
                      error={errors.maxPages}
                    />
                    <FormField
                      label="depth"
                      fieldId="knowledge.web.depth"
                      type="number"
                      min={1}
                      max={5}
                      value={draft.depth}
                      onChange={(e) => update("depth", e.target.value)}
                      error={errors.depth}
                    />
                    <Checkbox
                      label="same origin"
                      fieldId="knowledge.web.sameOrigin"
                      checked={draft.sameOrigin}
                      onChange={(v) => update("sameOrigin", v)}
                    />
                    <TextArea
                      label="include (one glob per line)"
                      fieldId="knowledge.include"
                      value={draft.includeStr}
                      onChange={(v) => update("includeStr", v)}
                    />
                    <TextArea
                      label="exclude (one glob per line)"
                      fieldId="knowledge.exclude"
                      value={draft.excludeStr}
                      onChange={(v) => update("excludeStr", v)}
                    />
                  </>
                )}
              </>
            )}
            {t === "mcp" && (
              <>
                <FormField
                  label="server"
                  fieldId="knowledge.mcp.server"
                  required
                  value={draft.server}
                  onChange={(e) => update("server", e.target.value)}
                  error={errors.server}
                />
                <FormField
                  label="tool"
                  fieldId="knowledge.mcp.tool"
                  required
                  value={draft.tool}
                  onChange={(e) => update("tool", e.target.value)}
                  error={errors.tool}
                />
                <FormField
                  label="preset"
                  fieldId="knowledge.mcp.preset"
                  value={draft.preset}
                  onChange={(e) => update("preset", e.target.value)}
                />
                <TextArea
                  label="args (one key=value per line)"
                  fieldId="knowledge.mcp.args"
                  value={draft.argsStr}
                  onChange={(v) => update("argsStr", v)}
                  error={errors.argsStr}
                />
                <Checkbox
                  label="allow write tool"
                  fieldId="knowledge.mcp.allowWriteTool"
                  checked={draft.allowWriteTool}
                  onChange={(v) => update("allowWriteTool", v)}
                />
              </>
            )}
            {t === "git" && (
              <>
                <FormField
                  label="ref (branch / tag / sha)"
                  fieldId="knowledge.git.ref"
                  value={draft.ref}
                  onChange={(e) => update("ref", e.target.value)}
                />
                <FormField
                  label="subpath"
                  fieldId="knowledge.git.subpath"
                  value={draft.subpath}
                  onChange={(e) => update("subpath", e.target.value)}
                />
                <TextArea
                  label="include (one glob per line)"
                  fieldId="knowledge.include"
                  value={draft.includeStr}
                  onChange={(v) => update("includeStr", v)}
                />
              </>
            )}
            {t === "npm" && (
              <FormField
                label="package"
                fieldId="knowledge.npm.package"
                required
                value={draft.pkg}
                onChange={(e) => update("pkg", e.target.value)}
                error={errors.pkg}
              />
            )}
            {t === "confluence" && (
              <>
                <FormField
                  label="space key"
                  fieldId="knowledge.confluence.space"
                  required
                  value={draft.space}
                  onChange={(e) => update("space", e.target.value)}
                  error={errors.space}
                />
                <TextArea
                  label="pages (one per line; numeric IDs as `id:12345`)"
                  fieldId="knowledge.confluence.pages"
                  value={draft.pagesStr}
                  onChange={(v) => update("pagesStr", v)}
                />
                <FormField
                  label="max pages"
                  fieldId="knowledge.confluence.maxPages"
                  type="number"
                  min={1}
                  max={100}
                  value={draft.maxPages}
                  onChange={(e) => update("maxPages", e.target.value)}
                  error={errors.maxPages}
                />
                <Checkbox
                  label="include children"
                  fieldId="knowledge.confluence.includeChildren"
                  checked={draft.includeChildren}
                  onChange={(v) => update("includeChildren", v)}
                />
                <Select
                  label="format"
                  fieldId="knowledge.confluence.format"
                  value={draft.format}
                  onChange={(v) => update("format", v as DraftState["format"])}
                  options={[
                    { v: "", l: "(default)" },
                    { v: "storage", l: "storage" },
                    { v: "view", l: "view" },
                    { v: "markdown", l: "markdown" },
                  ]}
                />
              </>
            )}
            {t === "jira" && (
              <>
                <FormField
                  label="jql"
                  fieldId="knowledge.jira.jql"
                  required
                  value={draft.jql}
                  onChange={(e) => update("jql", e.target.value)}
                  error={errors.jql}
                />
                <FormField
                  label="fields (comma-separated)"
                  fieldId="knowledge.jira.fields"
                  value={draft.fieldsStr}
                  onChange={(e) => update("fieldsStr", e.target.value)}
                />
                <FormField
                  label="max results"
                  fieldId="knowledge.jira.maxResults"
                  type="number"
                  min={1}
                  max={500}
                  value={draft.maxResults}
                  onChange={(e) => update("maxResults", e.target.value)}
                  error={errors.maxResults}
                />
              </>
            )}

            {/* ─── Common: description ─────────────────────────────── */}
            <FormField
              label="description"
              fieldId="knowledge.description"
              value={draft.description}
              onChange={(e) => update("description", e.target.value)}
            />

            {/* ─── Advanced (collapsible) ────────────────────────────── */}
            <button
              type="button"
              onClick={() => setAdvancedOpen((o) => !o)}
              className="font-mono text-[10px] uppercase tracking-widest text-matrix-green-muted hover:text-matrix-green pt-2"
              aria-expanded={advancedOpen}
              aria-controls="adv-section"
            >
              {advancedOpen ? "▼" : "▶"} advanced
            </button>
            {advancedOpen && (
              <div id="adv-section" className="space-y-3 pl-2 border-l border-matrix-line">
                <Select
                  label="delivery"
                  fieldId="knowledge.delivery"
                  value={draft.delivery}
                  onChange={(v) => update("delivery", v as Delivery)}
                  options={[
                    { v: "auto", l: "auto (default)" },
                    { v: "inline", l: "inline" },
                    { v: "file", l: "file" },
                  ]}
                  disabled={draft.lazy}
                  disabledTooltip="not used when lazy fetch is on"
                />
                <FormField
                  label="summary (compile TOC, max 280 chars)"
                  fieldId="knowledge.summary"
                  value={draft.summary}
                  onChange={(e) => update("summary", e.target.value)}
                  error={errors.summary}
                />
                <Select
                  label="include in compile TOC"
                  fieldId="knowledge.toc"
                  value={draft.toc}
                  onChange={(v) => update("toc", v as DraftState["toc"])}
                  options={[
                    { v: "default", l: "default" },
                    { v: "yes", l: "yes" },
                    { v: "no", l: "no" },
                  ]}
                />
                <Select
                  label="retrieval mode"
                  fieldId="knowledge.retrieval.mode"
                  value={draft.retrievalMode}
                  onChange={(v) => update("retrievalMode", v as RetrievalMode)}
                  options={[
                    { v: "bm25", l: "bm25 (default — local in-memory index)" },
                    { v: "external-mcp", l: "external-mcp (delegate to a remote MCP)" },
                    { v: "off", l: "off (advisory: not search-friendly)" },
                  ]}
                />
                {draft.retrievalMode === "external-mcp" && (
                  <FormField
                    label="retrieval.mcpUrl"
                    fieldId="knowledge.retrieval.mcpUrl"
                    required
                    value={draft.retrievalMcpUrl}
                    onChange={(e) => update("retrievalMcpUrl", e.target.value)}
                    error={errors.retrievalMcpUrl}
                  />
                )}
                <Select
                  label="materialize"
                  fieldId="knowledge.materialize"
                  value={draft.materialize}
                  onChange={(v) => update("materialize", v as DraftState["materialize"])}
                  options={[
                    { v: "", l: "(default — auto-detect)" },
                    { v: "markdown", l: "markdown" },
                    { v: "text", l: "text" },
                    { v: "html-to-md", l: "html-to-md" },
                    { v: "json", l: "json" },
                    { v: "passthrough", l: "passthrough" },
                  ]}
                  disabled={draft.lazy}
                  disabledTooltip="not used when lazy fetch is on"
                />
                {initial.invalidRefreshMode && (
                  <div
                    className="font-mono text-[10px] text-matrix-amber border border-matrix-amber/40 px-2 py-1"
                    role="status"
                  >
                    // This source is `type: {initial.invalidRefreshMode.type}` — only
                    `install` mode is allowed; the existing `
                    {initial.invalidRefreshMode.loadedMode}` value will be cleared on save.
                  </div>
                )}
                <Select
                  label="refresh mode"
                  fieldId="knowledge.refresh.mode"
                  value={draft.refreshMode}
                  onChange={(v) => update("refreshMode", v as DraftState["refreshMode"])}
                  options={
                    isStaticType(t)
                      ? [
                          { v: "", l: "(default — install only)" },
                          { v: "install", l: "install" },
                        ]
                      : [
                          { v: "", l: "(default — install only)" },
                          { v: "install", l: "install" },
                          { v: "ttl", l: "ttl" },
                          { v: "session", l: "session" },
                          { v: "always", l: "always" },
                        ]
                  }
                />
                {draft.refreshMode === "ttl" && (
                  <FormField
                    label="refresh ttl (e.g. 30m, 2h, 1d)"
                    fieldId="knowledge.refresh.ttl"
                    required
                    value={draft.refreshTtl}
                    onChange={(e) => update("refreshTtl", e.target.value)}
                    error={errors.refreshTtl}
                  />
                )}
                <FormField
                  label="refresh timeout (seconds, 1–60)"
                  fieldId="knowledge.refresh.timeout"
                  type="number"
                  min={1}
                  max={60}
                  value={draft.refreshTimeout}
                  onChange={(e) => update("refreshTimeout", e.target.value)}
                  hint="Per-source fetch budget; default 5s, max 60s."
                  error={errors.refreshTimeout}
                />
                <Checkbox
                  label="optional (treat fetch errors as warnings)"
                  fieldId="knowledge.optional"
                  checked={draft.optional}
                  onChange={(v) => update("optional", v)}
                />
                {draft.lazy ? (
                  <Tooltip content="not used when lazy fetch is on">
                    <span tabIndex={0} className="block text-matrix-green-muted line-through">
                      <FormField
                        label="inline budget tokens (1–16000)"
                        fieldId="knowledge.inlineBudgetTokens"
                        type="number"
                        min={1}
                        max={16000}
                        value={draft.inlineBudgetTokens}
                        onChange={(e) => update("inlineBudgetTokens", e.target.value)}
                        hint="Per-source inline cap; falls back to bundle inlineBudget."
                        error={errors.inlineBudgetTokens}
                        disabled
                      />
                    </span>
                  </Tooltip>
                ) : (
                  <FormField
                    label="inline budget tokens (1–16000)"
                    fieldId="knowledge.inlineBudgetTokens"
                    type="number"
                    min={1}
                    max={16000}
                    value={draft.inlineBudgetTokens}
                    onChange={(e) => update("inlineBudgetTokens", e.target.value)}
                    hint="Per-source inline cap; falls back to bundle inlineBudget."
                    error={errors.inlineBudgetTokens}
                  />
                )}
              </div>
            )}
          </form>

          {save.isError && (
            <div className="font-mono text-[10px] text-matrix-red mt-3" role="alert">
              // error: {save.error instanceof Error ? save.error.message : String(save.error)}
            </div>
          )}

          <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-matrix-line">
            <Button variant="ghost" onClick={requestClose}>
              Cancel
            </Button>
            <Button type="submit" form={formId} disabled={!valid || !dirty || save.isPending}>
              {save.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </div>
      {confirmDiscard && (
        <ConfirmModal
          title="Discard unsaved changes?"
          body="You have unsaved changes to this knowledge source. Discard them?"
          confirmLabel="Discard"
          danger
          onCancel={() => setConfirmDiscard(false)}
          onConfirm={() => {
            setConfirmDiscard(false);
            onClose();
          }}
        />
      )}
      {confirmStale && (
        <StaleArtifactsConfirmModal
          onCancel={() => setConfirmStale(false)}
          onSaveKeep={() => {
            setConfirmStale(false);
            performSave();
          }}
          onSaveDelete={() => {
            setConfirmStale(false);
            void deleteCacheThenSave();
          }}
        />
      )}
    </>
  );
}

// ─── Tiny presentational helpers (keep parity with the Add modal's look) ──

function HelpLabel({
  label,
  htmlFor,
  fieldId,
}: {
  label: string;
  htmlFor: string;
  fieldId?: string | undefined;
}) {
  if (fieldId) {
    return (
      <FieldHelp fieldId={fieldId} htmlFor={htmlFor}>
        {label}
      </FieldHelp>
    );
  }
  return (
    <label
      htmlFor={htmlFor}
      className="font-mono text-[10px] uppercase tracking-widest text-matrix-green-muted"
    >
      // {label}
    </label>
  );
}

function TextArea({
  label,
  fieldId,
  value,
  onChange,
  error,
}: {
  label: string;
  fieldId?: string | undefined;
  value: string;
  onChange: (v: string) => void;
  error?: string | undefined;
}) {
  const id = `f-${label.replace(/\s+/g, "-").toLowerCase()}`;
  return (
    <div className="flex flex-col gap-1">
      <HelpLabel label={label} htmlFor={id} fieldId={fieldId} />
      <textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        className="bg-black border border-matrix-line px-2 py-1 font-mono text-sm text-matrix-body focus:outline-none focus:border-matrix-green focus:shadow-matrix-focus"
      />
      {error && <span className="font-mono text-[10px] text-matrix-red">{error}</span>}
    </div>
  );
}

function Select({
  label,
  fieldId,
  value,
  onChange,
  options,
  disabled,
  disabledTooltip,
}: {
  label: string;
  fieldId?: string | undefined;
  value: string;
  onChange: (v: string) => void;
  options: { v: string; l: string }[];
  disabled?: boolean;
  /** When set together with `disabled`, wrap the field in a Tooltip
   *  showing this text on hover/focus. Also applies the visual disabled
   *  treatment (greyed + strikethrough on the label). */
  disabledTooltip?: string;
}) {
  const id = `f-${label.replace(/\s+/g, "-").toLowerCase()}`;
  const wrapperClass = disabled
    ? "flex flex-col gap-1 text-matrix-green-muted line-through"
    : "flex flex-col gap-1";
  const select = (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className="bg-black border border-matrix-line px-2 py-1 font-mono text-sm text-matrix-body focus:outline-none focus:border-matrix-green disabled:opacity-50"
    >
      {options.map((o) => (
        <option key={o.v} value={o.v}>
          {o.l}
        </option>
      ))}
    </select>
  );
  const body = (
    <div className={wrapperClass}>
      <HelpLabel label={label} htmlFor={id} fieldId={fieldId} />
      {disabled && disabledTooltip ? (
        <Tooltip content={disabledTooltip}>
          <span tabIndex={0}>{select}</span>
        </Tooltip>
      ) : (
        select
      )}
    </div>
  );
  return body;
}

function Checkbox({
  label,
  fieldId,
  checked,
  onChange,
}: {
  label: string;
  fieldId?: string | undefined;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  const id = `f-${label.replace(/\s+/g, "-").toLowerCase()}`;
  // Checkboxes don't use the FieldHelp wrapper because the click target needs
  // to remain the label+input pair. Instead we render a sibling FieldHelp
  // span when a fieldId is supplied so the icon appears next to the label
  // without breaking the click semantics.
  return (
    <div className="flex items-center gap-2 font-mono text-sm text-matrix-body">
      <label htmlFor={id} className="flex items-center gap-2 cursor-pointer">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span>{label}</span>
      </label>
      {fieldId && (
        <FieldHelp fieldId={fieldId} htmlFor={id} iconOnly>
          {`${label} help`}
        </FieldHelp>
      )}
    </div>
  );
}
