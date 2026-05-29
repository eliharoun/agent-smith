import type { AtlassianEnvUpdate } from "gui-shared";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useAtlassianAffectedSources } from "@/hooks/useAtlassianAffectedSources";
import { useAtlassianEnv, useUpdateAtlassianEnv } from "@/hooks/useAtlassianEnv";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Chip } from "@/ui/Chip";
import { FormField } from "@/ui/FormField";

/**
 * Configure Atlassian credentials for Confluence + Jira knowledge sources.
 *
 * Backed by the existing /api/atlassian-env routes (Phase 1):
 *   - GET  → AtlassianEnvStatus { source, email?, hasToken, baseUrl?, editable }
 *   - PUT  → AtlassianEnvUpdate { email, apiToken, baseUrl? }
 *           returns 409 NOT_EDITABLE when status.source is `env`.
 *
 * Deviation from plan: the actual `AtlassianEnvUpdate` schema only carries
 * email/apiToken/baseUrl; the plan's defaultSpace/defaultProject fields and
 * a /test-connection endpoint don't exist in the codebase. We surface a
 * "credentials saved" inline state instead of a toast and skip the test
 * action. Future task can add them via separate schema/endpoint changes.
 *
 * Token UX: never read back from the server (`hasToken: boolean` only).
 * Initial render shows a placeholder with a "replace token" button; the
 * input is disabled until the user opts in. Submitting an empty `apiToken`
 * keeps the existing token (the route accepts empty string per the schema
 * — see `atlassian-env.ts`).
 */
export function AtlassianEnvForm() {
  const env = useAtlassianEnv();
  const affected = useAtlassianAffectedSources();
  const update = useUpdateAtlassianEnv();

  const [email, setEmail] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [replacingToken, setReplacingToken] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // Seed from server state on first successful fetch.
  if (env.data && email === "" && baseUrl === "" && !update.isPending) {
    if (env.data.email) setEmail(env.data.email);
    if (env.data.baseUrl) setBaseUrl(env.data.baseUrl);
  }

  if (env.isLoading) {
    return (
      <Card>
        <Header />
        <div className="font-mono text-sm text-matrix-body">// loading…</div>
      </Card>
    );
  }
  if (env.isError) {
    return (
      <Card>
        <Header />
        <div className="font-mono text-sm text-matrix-red">
          // failed to load — {(env.error as Error).message}
        </div>
        <Button variant="ghost" onClick={() => env.refetch()}>
          retry
        </Button>
      </Card>
    );
  }

  const status = env.data!;
  const editable = status.editable;
  const sourceLabel = describeSource(status.source);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSavedAt(null);
    // Send the entered token when either (a) no existing token (initial
    // setup) or (b) the user clicked "replace token". Otherwise send
    // empty string ("keep existing", per the route's schema contract).
    const sendingNewToken = !status.hasToken || replacingToken;
    const payload: AtlassianEnvUpdate = {
      email,
      apiToken: sendingNewToken ? apiToken : "",
      ...(baseUrl ? { baseUrl } : {}),
    };
    update.mutate(payload, {
      onSuccess: () => {
        setSavedAt(Date.now());
        setApiToken("");
        setReplacingToken(false);
      },
    });
  }

  const submitError = update.isError ? (update.error as Error).message : null;
  const conflict = submitError?.includes("NOT_EDITABLE") || !editable;

  return (
    <>
      <Card>
        <Header />
        <div className="mb-3 font-mono text-[11px] text-matrix-green-muted flex items-center gap-2">
          <span>source: {sourceLabel}</span>
          {status.hasToken ? (
            <Chip tone="green">token present</Chip>
          ) : (
            <Chip tone="amber">no token</Chip>
          )}
          {!editable && <Chip tone="amber">read-only</Chip>}
        </div>
        {!editable && (
          <div className="mb-3 font-mono text-[11px] text-matrix-body bg-matrix-line/40 p-2 border border-matrix-line">
            // credentials resolved from <b>{sourceLabel}</b>. The GUI can only write to{" "}
            <code>~/.config/agent-smith/.env</code>; unset the process env variables
            (SMITH_ATLASSIAN_*) to enable editing here.
          </div>
        )}
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <FormField
            label="email"
            type="email"
            required
            disabled={!editable || update.isPending}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="ada@acme.com"
          />
          <FormField
            label="base url (optional)"
            type="url"
            disabled={!editable || update.isPending}
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://acme.atlassian.net"
            hint="If omitted, knowledge sources must include full URLs."
          />
          {status.hasToken && !replacingToken ? (
            <div className="flex items-end gap-2">
              <FormField label="api token" value="••••••••" disabled className="flex-1" />
              <Button
                variant="ghost"
                type="button"
                disabled={!editable}
                onClick={() => setReplacingToken(true)}
              >
                replace token
              </Button>
            </div>
          ) : (
            <FormField
              label="api token"
              type="password"
              required={!status.hasToken}
              disabled={!editable || update.isPending}
              value={apiToken}
              onChange={(e) => setApiToken(e.target.value)}
              placeholder="paste from id.atlassian.com → Create API token"
              {...(status.hasToken ? { hint: "leave blank to keep existing token" } : {})}
            />
          )}
          {(!status.hasToken || replacingToken) && (
            // Discoverability hint with the canonical Atlassian token URL.
            // The 'Create API token' button (NOT 'Create API token with
            // scopes') is the smith-supported flow — see
            // src/io/atlassian-auth.ts:tokenCreationInstructions for why.
            <div className="font-mono text-[10px] text-matrix-green-muted -mt-1 ml-1">
              Need one?{" "}
              <a
                href="https://id.atlassian.com/manage-profile/security/api-tokens"
                target="_blank"
                rel="noreferrer"
                className="text-matrix-green hover:underline"
              >
                Create an API token
              </a>{" "}
              (use the unscoped &lsquo;Create API token&rsquo; button — smith doesn&rsquo;t yet
              support scoped tokens). Tokens expire after 1-365 days; copy the token immediately, it
              can&rsquo;t be recovered later.
            </div>
          )}
          <div className="flex items-center gap-3">
            <Button
              type="submit"
              disabled={
                !editable ||
                update.isPending ||
                email.length === 0 ||
                (!status.hasToken && apiToken.length === 0)
              }
            >
              {update.isPending ? "saving…" : "save credentials"}
            </Button>
            {savedAt !== null && <Chip tone="green">saved</Chip>}
            {submitError && (
              <span className="font-mono text-[11px] text-matrix-red">
                {conflict ? "cannot write — credentials are read-only" : submitError}
              </span>
            )}
          </div>
        </form>
      </Card>
      <AffectedSourcesCard
        loading={affected.isLoading}
        error={affected.error}
        sources={affected.data?.sources ?? []}
      />
    </>
  );
}

function Header() {
  return (
    <div className="font-mono text-[10px] uppercase tracking-widest text-matrix-green-muted mb-3">
      // atlassian credentials — shared by confluence + jira sources
    </div>
  );
}

function describeSource(source: string): string {
  switch (source) {
    case "env":
      return "process env (SMITH_*)";
    case "smith-env-file":
      return "~/.config/agent-smith/.env";
    case "none":
      return "none";
    default:
      return source;
  }
}

function AffectedSourcesCard({
  loading,
  error,
  sources,
}: {
  loading: boolean;
  error: unknown;
  sources: { agent: string; sourceId: string; type: string; label?: string }[];
}) {
  return (
    <Card>
      <div className="font-mono text-[10px] uppercase tracking-widest text-matrix-green-muted mb-3">
        // affected sources
      </div>
      {loading ? (
        <div className="font-mono text-sm text-matrix-body">// loading…</div>
      ) : error ? (
        <div className="font-mono text-sm text-matrix-red">
          // failed to load — {(error as Error).message}
        </div>
      ) : sources.length === 0 ? (
        <div className="font-mono text-sm text-matrix-body">
          // no confluence or jira sources are registered yet.
        </div>
      ) : (
        <ul className="divide-y divide-matrix-line">
          {sources.map((s) => (
            <li
              key={`${s.agent}/${s.sourceId}`}
              className="py-2 flex items-center justify-between gap-3"
            >
              <div className="min-w-0">
                <div className="font-mono text-sm text-matrix-green">
                  <Link to={`/agents/${s.agent}?tab=knowledge`} className="hover:underline">
                    {s.agent}
                  </Link>
                  <span className="text-matrix-green-muted"> / {s.sourceId}</span>
                </div>
                {s.label && (
                  <div className="font-mono text-[11px] text-matrix-green-muted mt-0.5 truncate">
                    {s.label}
                  </div>
                )}
              </div>
              <Chip tone="neutral">{s.type}</Chip>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
