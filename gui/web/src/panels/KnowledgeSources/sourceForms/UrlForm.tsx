import { useMemo, useState } from "react";
import { useMcpServersAndTools } from "@/hooks/useMcpServersAndTools";
import { FormField } from "@/ui/FormField";
import { type CommonFields, commonFields, validateId } from "./common";
import type { SourceFormProps } from "./types";

const DIRECT_HTTP = "" as const;

/**
 * URL form. typeOrUrl is the URL itself (URL-shortcut form recognised by
 * the CLI when http(s) is passed as the first positional argument), so
 * pathOrUrl is omitted.
 *
 * Routing dropdown (v1.4): mirrors the CLI's `pickViaInteractively`. The
 * dropdown defaults to "Direct HTTP (no routing)"; picking a server
 * triggers a tool sub-pick (auto-selected when there's exactly one
 * URL-shaped tool). On save, when a server was picked the modal writes
 * `via:` to the source via the agent-config PUT path AND extends
 * `mcpServers[]` if the server wasn't already declared.
 */
export function UrlForm({ existingIds, onSubmit, formId, agent }: SourceFormProps) {
  const [c, setC] = useState<CommonFields>({ id: "", description: "" });
  const [url, setUrl] = useState("");
  const [server, setServer] = useState<string>(DIRECT_HTTP);
  const [tool, setTool] = useState<string>("");
  const idErr = validateId(c.id, existingIds);

  // Only fetch the picker payload when the user has typed a URL — keeps
  // the per-request MCP spawns off the wire when the form is just being
  // explored. The hook is always called; `enabled` gates the actual fetch.
  const picker = useMcpServersAndTools(agent ?? "", Boolean(agent && url));

  const httpsWarn =
    url && !url.startsWith("https://") ? "non-https URL — content may be intercepted" : undefined;

  // Tool list for the currently-selected server. Empty array when no
  // server is picked OR the server returned an error from the lookup.
  const serverEntry = picker.data?.servers.find((s) => s.name === server);
  const tools = useMemo(() => {
    if (!server || !picker.data) return [];
    return picker.data.toolsByServer[server] ?? [];
  }, [server, picker.data]);

  // Tool auto-selection: when exactly one URL-shaped tool exists, set it
  // silently so the user doesn't have to confirm. The CLI does the same
  // (notify(`→ routing through ${server}.${tool}`) without prompting).
  const autoTool = tools.length === 1 ? tools[0]!.name : "";
  const effectiveTool = tools.length === 1 ? autoTool : tool;

  // Save-blocker conditions. Surfaced as inline form errors so the user
  // sees why Save is disabled.
  let routingError: string | undefined;
  if (server) {
    if (serverEntry?.error) routingError = `server unavailable: ${serverEntry.error}`;
    else if (picker.isLoading)
      routingError = undefined; // pending; tool-required check below skips
    else if (tools.length === 0)
      routingError = "no URL-shaped tools on this server (pick a different one or use Direct HTTP)";
    else if (tools.length > 1 && !tool) routingError = "pick a tool to route through";
  }
  const blockSubmit = Boolean(server) && Boolean(routingError);

  return (
    <form
      id={formId}
      onSubmit={(e) => {
        e.preventDefault();
        if (idErr || !url || blockSubmit) return;
        const submission: Parameters<typeof onSubmit>[0] = {
          request: {
            typeOrUrl: url,
            id: c.id,
            description: c.description || undefined,
            optional: false,
            install: true,
            includeChildren: false,
          },
        };
        if (server && effectiveTool) {
          // serverWasAdded mirrors the CLI's pickViaInteractively — true
          // only when the picked server originated solely from the AI
          // client config. Bundle-only and "both" servers are already in
          // the bundle's mcpServers[].
          submission.via = {
            server,
            tool: effectiveTool,
            serverWasAdded: serverEntry?.source === "available",
          };
        }
        onSubmit(submission);
      }}
      className="space-y-3"
    >
      {commonFields(c, setC, idErr)}
      <FormField
        label="url"
        fieldId="knowledge.url"
        required
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://example.com/page"
        hint={httpsWarn}
      />
      {/* Routing dropdown — only meaningful once a URL is entered AND we
          have agent context. */}
      {agent && url && (
        <RoutingPicker
          servers={picker.data?.servers ?? []}
          isLoading={picker.isLoading}
          isError={picker.isError}
          server={server}
          tools={tools}
          tool={tool}
          autoTool={autoTool}
          routingError={routingError}
          onPickServer={(v) => {
            setServer(v);
            setTool("");
          }}
          onPickTool={setTool}
        />
      )}
    </form>
  );
}

interface RoutingPickerProps {
  servers: ReadonlyArray<{
    name: string;
    source: "bundle" | "available" | "both";
    error?: string | undefined;
  }>;
  isLoading: boolean;
  isError: boolean;
  server: string;
  tools: ReadonlyArray<{ name: string }>;
  tool: string;
  autoTool: string;
  routingError: string | undefined;
  onPickServer: (v: string) => void;
  onPickTool: (v: string) => void;
}

function badgeFor(source: "bundle" | "available" | "both"): string {
  if (source === "bundle") return "[from bundle]";
  if (source === "both") return "[from bundle + AI client]";
  return "[from AI client]";
}

function RoutingPicker(p: RoutingPickerProps) {
  // No candidates available at all — render a hint instead of an empty
  // dropdown. Saves the user from a confusing "(none)" select that
  // implies routing is configurable when it isn't.
  if (!p.isLoading && p.servers.length === 0) {
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
      <div className="font-mono text-[10px] uppercase tracking-widest text-matrix-green-muted">
        // route through MCP server
      </div>
      <select
        aria-label="route through MCP server"
        value={p.server}
        onChange={(e) => p.onPickServer(e.target.value)}
        disabled={p.isLoading || p.isError}
        className="bg-black border border-matrix-line px-2 py-1 font-mono text-sm text-matrix-body focus:outline-none focus:border-matrix-green"
      >
        <option value="">{p.isLoading ? "loading…" : "(none — direct HTTP)"}</option>
        {p.servers.map((s) => (
          <option key={s.name} value={s.name} disabled={Boolean(s.error)}>
            {s.name} {badgeFor(s.source)}
            {s.error ? " — unavailable" : ""}
          </option>
        ))}
      </select>
      {/* Tool sub-picker: render only when 2+ URL-shaped tools exist; with
          0 or 1 we show inline status instead. */}
      {p.server && p.tools.length > 1 && (
        <select
          aria-label="route through tool"
          value={p.tool}
          onChange={(e) => p.onPickTool(e.target.value)}
          className="bg-black border border-matrix-line px-2 py-1 font-mono text-sm text-matrix-body focus:outline-none focus:border-matrix-green"
        >
          <option value="">(pick a tool)</option>
          {p.tools.map((t) => (
            <option key={t.name} value={t.name}>
              {t.name}
            </option>
          ))}
        </select>
      )}
      {p.server && p.autoTool && (
        <div className="font-mono text-[10px] text-matrix-green">
          → routing through {p.server}.{p.autoTool}
        </div>
      )}
      {p.routingError && (
        <div className="font-mono text-[10px] text-matrix-red" role="alert">
          // {p.routingError}
        </div>
      )}
    </div>
  );
}
