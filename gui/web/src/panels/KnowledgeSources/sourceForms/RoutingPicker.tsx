import type { McpServerAndToolsView, McpServerSource, McpUrlShapedTool } from "gui-shared";
import { useMemo } from "react";
import { useMcpServersAndTools } from "@/hooks/useMcpServersAndTools";

/**
 * Self-contained routing dropdown for URL knowledge sources. Shared by the
 * Add Knowledge Source modal (where the picker is gated on a typed URL) and
 * the Edit Knowledge Source modal (where the existing source's `via:` block
 * is pre-selected). Mirrors the CLI's `pickViaInteractively`:
 *
 *  - default option = "(none — direct HTTP)"
 *  - server `<select>` lists bundle ∪ AI-client servers with a source badge
 *  - when a server has 2+ URL-shaped tools, a tool sub-picker appears
 *  - when a server has exactly 1 URL-shaped tool, it is auto-selected and the
 *    chosen route is shown inline ("→ routing through <server>.<tool>")
 *
 * Edit-flow extras (driven by `currentMcpServers`): when the source's
 * `value.server` is set but isn't present in the fetched server list (e.g.,
 * the bundle declared the server but the AI client never installed it, or
 * the user removed it from `mcpServers[]` after authoring the source), the
 * dropdown still shows that server pre-selected with a `[not configured]`
 * badge so the user is told why it's flagged.
 */

export type ViaPick = { server: string; tool: string };

interface Props {
  agent: string;
  /** Whether the parent has the inputs needed to render the picker meaningfully. */
  enabled?: boolean;
  /** Currently-picked route, or null for direct HTTP. */
  value: ViaPick | null;
  /**
   * Called when the user changes the server, switches the tool, or reverts
   * to direct HTTP. The parent stores the result in its draft state; the
   * picker itself is stateless beyond the hook.
   */
  onChange: (next: ViaPick | null) => void;
  /**
   * The agent's currently-declared `mcpServers[]`. Used to decide whether a
   * pre-selected server is "configured" — when `value.server` is set but
   * neither in the fetched server list NOR in this array, the picker shows
   * `[not configured]` so the user knows the bundle won't ship the wiring.
   */
  currentMcpServers?: ReadonlyArray<string>;
  /** When true, swallows the error state (the parent renders its own banner). */
  hideError?: boolean;
}

function badgeFor(source: McpServerSource): string {
  if (source === "bundle") return "[from bundle]";
  if (source === "both") return "[from bundle + AI client]";
  return "[from AI client]";
}

/** Pure helper — extracted for tests and reuse. */
function deriveTools(
  data: McpServerAndToolsView | undefined,
  server: string,
): ReadonlyArray<McpUrlShapedTool> {
  if (!server || !data) return [];
  return data.toolsByServer[server] ?? [];
}

export function RoutingPicker({
  agent,
  enabled = true,
  value,
  onChange,
  currentMcpServers = [],
  hideError,
}: Props) {
  const picker = useMcpServersAndTools(agent, enabled && agent.length > 0);
  const server = value?.server ?? "";
  const tool = value?.tool ?? "";

  const serverEntry = picker.data?.servers.find((s) => s.name === server);
  const tools = useMemo(() => deriveTools(picker.data, server), [picker.data, server]);

  // Pre-selected-but-missing case: the source has `via.server: X` and X
  // isn't in the fetched list. Render an injected "ghost" entry at the top
  // (after the direct-HTTP option) so the user sees their current state and
  // a `[not configured]` warning. Edit-only — the Add modal never seeds
  // `value` from outside the dropdown.
  const fetchedNames = useMemo(
    () => new Set(picker.data?.servers.map((s) => s.name) ?? []),
    [picker.data],
  );
  const ghostServer = server && !fetchedNames.has(server) ? server : null;
  const declaredButMissing = ghostServer && !currentMcpServers.includes(ghostServer);

  // Tool auto-selection: when exactly one URL-shaped tool exists, treat it
  // as picked silently. Skip auto-selection when no list is available
  // (loading, error, ghost server) — leave whatever the parent set as-is.
  const autoTool = tools.length === 1 ? tools[0]!.name : "";
  const effectiveTool = tools.length === 1 ? autoTool : tool;

  // When auto-tool kicks in, propagate it back to the parent so save-time
  // sees the resolved route. Effect-free: we only fire when the value
  // disagrees with the auto-tool to avoid loops.
  if (server && tools.length === 1 && tool !== autoTool && value !== null) {
    // Defer through a microtask so we don't update during render.
    queueMicrotask(() => onChange({ server, tool: autoTool }));
  }

  // Inline error/warn surfaced when a server is picked but not actionable.
  let routingError: string | undefined;
  if (server) {
    if (serverEntry?.error) routingError = `server unavailable: ${serverEntry.error}`;
    else if (picker.isLoading) routingError = undefined;
    else if (ghostServer) {
      // Ghost server: don't block — the user can still pick another server
      // or revert to direct HTTP. The badge already warns them.
      routingError = undefined;
    } else if (tools.length === 0) {
      routingError = "no URL-shaped tools on this server (pick a different one or use Direct HTTP)";
    } else if (tools.length > 1 && !tool) routingError = "pick a tool to route through";
  }

  const onPickServer = (next: string) => {
    if (!next) {
      onChange(null);
      return;
    }
    // When switching to a different server, drop any stale tool — the
    // sub-picker (or auto-tool) will resolve fresh.
    onChange({ server: next, tool: "" });
  };
  const onPickTool = (next: string) => {
    if (!server) return;
    onChange({ server, tool: next });
  };

  // No candidates at all (and no preselected ghost): direct-HTTP-only hint.
  // Skip this on error — a failed probe leaves `data` undefined, and we must
  // fall through to the main view so the user gets the refresh control and the
  // "failed to load" line instead of a misleading "no servers declared" note.
  if (
    !picker.isLoading &&
    !picker.isError &&
    !ghostServer &&
    (picker.data?.servers.length ?? 0) === 0
  ) {
    return (
      <div
        className="font-mono text-[10px] text-matrix-green-muted border border-matrix-line px-2 py-1"
        role="note"
        aria-label="routing options"
      >
        // direct HTTP only — no MCP servers declared in the bundle or AI client config
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 border border-matrix-line p-2">
      <div className="flex items-center justify-between">
        <div className="font-mono text-[10px] uppercase tracking-widest text-matrix-green-muted">
          // route through MCP server
        </div>
        {/* Re-probe the servers. Spawning each MCP server can fail transiently
            (spawn race, timeout), so a server may be missing or flagged
            unavailable; refetch re-runs the probe, bypassing the hook's
            staleTime. */}
        <button
          type="button"
          aria-label="refresh MCP servers"
          title="refresh MCP servers"
          onClick={() => picker.refetch()}
          disabled={picker.isFetching}
          className="font-mono text-sm text-matrix-green-muted hover:text-matrix-green focus:outline-none focus:text-matrix-green disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <span aria-hidden className={picker.isFetching ? "inline-block animate-spin" : ""}>
            ↻
          </span>
        </button>
      </div>
      <select
        aria-label="route through MCP server"
        value={server}
        onChange={(e) => onPickServer(e.target.value)}
        disabled={picker.isLoading || (picker.isError && !ghostServer)}
        className="bg-black border border-matrix-line px-2 py-1 font-mono text-sm text-matrix-body focus:outline-none focus:border-matrix-green"
      >
        <option value="">{picker.isLoading ? "loading…" : "(none — direct HTTP)"}</option>
        {ghostServer && (
          <option value={ghostServer}>
            {ghostServer} {declaredButMissing ? "[not configured]" : "[not in available servers]"}
          </option>
        )}
        {picker.data?.servers.map((s) => (
          <option key={s.name} value={s.name} disabled={Boolean(s.error)}>
            {s.name} {badgeFor(s.source)}
            {s.error ? " — unavailable" : ""}
          </option>
        ))}
      </select>
      {/* Tool sub-picker only when 2+ URL-shaped tools exist. */}
      {server && !ghostServer && tools.length > 1 && (
        <select
          aria-label="route through tool"
          value={tool}
          onChange={(e) => onPickTool(e.target.value)}
          className="bg-black border border-matrix-line px-2 py-1 font-mono text-sm text-matrix-body focus:outline-none focus:border-matrix-green"
        >
          <option value="">(pick a tool)</option>
          {tools.map((t) => (
            <option key={t.name} value={t.name}>
              {t.name}
            </option>
          ))}
        </select>
      )}
      {/* Ghost server: show the existing tool inline read-only. The user
          can switch to another server or to direct HTTP, but cannot edit
          the tool here because we don't know what tools the missing server
          exposes. */}
      {ghostServer && tool && (
        <div className="font-mono text-[10px] text-matrix-amber" role="note">
          → routing through {ghostServer}.{tool}{" "}
          {declaredButMissing ? "(server not in mcpServers[])" : ""}
        </div>
      )}
      {server && !ghostServer && effectiveTool && tools.length === 1 && (
        <div className="font-mono text-[10px] text-matrix-green">
          → routing through {server}.{effectiveTool}
        </div>
      )}
      {!hideError && picker.isError && (
        <div className="font-mono text-[10px] text-matrix-red" role="alert">
          // failed to load MCP servers — try refreshing
        </div>
      )}
      {routingError && (
        <div className="font-mono text-[10px] text-matrix-red" role="alert">
          // {routingError}
        </div>
      )}
    </div>
  );
}

/**
 * Returns true when the current pick is "ready to save" — i.e., either the
 * user picked direct HTTP (null) or both server and a tool are resolved
 * (single-tool servers count as resolved via auto-tool).
 */
export function isRoutingReady(
  data: McpServerAndToolsView | undefined,
  value: ViaPick | null,
): boolean {
  if (value === null) return true;
  if (!value.server) return false;
  const tools = deriveTools(data, value.server);
  if (tools.length === 0) {
    // Ghost server — we accept whatever tool the source already had.
    return Boolean(value.tool);
  }
  if (tools.length === 1) return true;
  return Boolean(value.tool);
}
