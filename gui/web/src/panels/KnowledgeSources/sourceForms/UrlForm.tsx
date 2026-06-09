import { useMemo, useState } from "react";
import { useMcpServersAndTools } from "@/hooks/useMcpServersAndTools";
import { FormField } from "@/ui/FormField";
import { Toggle } from "@/ui/Toggle";
import { type CommonFields, commonFields, inferIdFromUrl, validateId } from "./common";
import { RoutingPicker, type ViaPick } from "./RoutingPicker";
import type { SourceFormProps } from "./types";

/**
 * URL form. typeOrUrl is the URL itself (URL-shortcut form recognised by
 * the CLI when http(s) is passed as the first positional argument), so
 * pathOrUrl is omitted.
 *
 * Routing dropdown: delegates to `RoutingPicker` (shared with the Edit
 * modal). On save the form decides whether to emit a `via:` block — the
 * picker's value plus the fetched server-list data drive that decision so
 * the Add modal can compute `serverWasAdded` and trigger the bundle
 * `mcpServers[]` extension. The Edit modal does not need that logic
 * because RoutingPicker is presentational; routing semantics belong here.
 */
export function UrlForm({ existingIds, onSubmit, formId, agent }: SourceFormProps) {
  const [c, setC] = useState<CommonFields>({ id: "", description: "" });
  const [url, setUrl] = useState("");
  const [via, setVia] = useState<ViaPick | null>(null);
  const [lazy, setLazy] = useState(false);
  // Once the user types in the id field we stop overwriting it from the URL.
  const [idTouched, setIdTouched] = useState(false);
  const idErr = validateId(c.id, existingIds);

  // Auto-fill the id from the URL until the user takes ownership of the field.
  const handleUrlChange = (next: string) => {
    setUrl(next);
    if (idTouched) return;
    const inferred = inferIdFromUrl(next);
    if (inferred) setC((p) => ({ ...p, id: inferred }));
  };

  // Mirror the picker's gating: only fetch when the user has typed a URL.
  // The hook is also called inside RoutingPicker but tanstack-query
  // dedupes by key — both calls share the same in-flight request.
  const picker = useMcpServersAndTools(agent ?? "", Boolean(agent && url));

  const httpsWarn =
    url && !url.startsWith("https://") ? "non-https URL — content may be intercepted" : undefined;

  const serverEntry = picker.data?.servers.find((s) => s.name === via?.server);
  const tools = useMemo(() => {
    if (!via?.server || !picker.data) return [];
    return picker.data.toolsByServer[via.server] ?? [];
  }, [via?.server, picker.data]);
  const autoTool = tools.length === 1 ? tools[0]!.name : "";
  const effectiveTool = tools.length === 1 ? autoTool : via?.tool || "";

  // Save-blocker: server picked but not actionable.
  let blockSubmit = false;
  if (via?.server) {
    if (serverEntry?.error) blockSubmit = true;
    else if (picker.isLoading) blockSubmit = false;
    else if (tools.length === 0) blockSubmit = true;
    else if (tools.length > 1 && !via.tool) blockSubmit = true;
  }

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
            ...(lazy ? { lazy: true } : {}),
          },
        };
        if (via?.server && effectiveTool) {
          // serverWasAdded mirrors the CLI's pickViaInteractively — true
          // only when the picked server originated solely from the AI
          // client config. Bundle-only and "both" servers are already in
          // the bundle's mcpServers[].
          submission.via = {
            server: via.server,
            tool: effectiveTool,
            serverWasAdded: serverEntry?.source === "available",
          };
        }
        onSubmit(submission);
      }}
      className="space-y-3"
    >
      {commonFields(c, setC, idErr, () => setIdTouched(true))}
      <FormField
        label="url"
        fieldId="knowledge.url"
        required
        value={url}
        onChange={(e) => handleUrlChange(e.target.value)}
        placeholder="https://example.com/page"
        hint={httpsWarn}
      />
      <div className="flex flex-col gap-1">
        <Toggle aria-label="Lazy fetch" label="lazy fetch" checked={lazy} onChange={setLazy} />
        {lazy && (
          <p className="font-mono text-[10px] text-matrix-green-muted">
            // when lazy is on, the agent reads this description at runtime to
            decide whether to fetch the URL — write what the source contains
            and when to use it.
          </p>
        )}
      </div>
      {/* Routing dropdown — only meaningful once a URL is entered AND we
          have agent context. */}
      {agent && url && (
        <RoutingPicker agent={agent} enabled value={via} onChange={setVia} />
      )}
    </form>
  );
}
