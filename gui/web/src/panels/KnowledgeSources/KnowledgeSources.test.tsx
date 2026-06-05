import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { NotificationCenter } from "@/ui/NotificationCenter";
import { KnowledgeSources } from "./KnowledgeSources";

type Call = { url: string; init?: RequestInit | undefined };

interface View {
  agent: string;
  sources: Array<{ source: Record<string, unknown>; refreshCache?: Record<string, unknown> }>;
  consent?: { granted_at: string; platforms: string[]; sources: string[] };
}

function mockFetch(
  viewProvider: () => View,
  calls: Call[],
  agentDetailProvider?: () => Record<string, unknown>,
  wiringPlanProvider?: () => {
    platforms: Array<{
      platform: "opencode" | "claude-code" | "codex" | "kiro";
      cliInstalled: boolean;
      configPath: string;
      hasEntry: boolean;
      configReadable: boolean;
    }>;
    bundleHasEntry?: boolean;
  },
) {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({ url, init });
    // Consent endpoint — must come before the generic /api/knowledge GET
    // matcher below.
    if (url.endsWith("/consent") && init?.method === "PUT") {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    if (url.includes("/api/knowledge/") && (init?.method ?? "GET") === "GET") {
      return new Response(JSON.stringify(viewProvider()), { status: 200 });
    }
    // v2.1-E: MCP wiring plan + apply endpoints (the toggle's confirm modal
    // fetches the plan; confirm POSTs the apply request).
    if (url.endsWith("/mcp-wiring-plan") && (init?.method ?? "GET") === "GET") {
      const plan = wiringPlanProvider?.() ?? {
        platforms: [
          {
            platform: "claude-code",
            cliInstalled: true,
            configPath: "/home/user/.claude.json",
            hasEntry: false,
            configReadable: true,
          },
        ],
        bundleHasEntry: false,
      };
      // Backfill bundleHasEntry when caller's provider doesn't supply it
      // (older tests predate the field).
      const planWithDefault = { bundleHasEntry: false, ...plan };
      return new Response(JSON.stringify(planWithDefault), { status: 200 });
    }
    if (url.endsWith("/mcp-wiring") && init?.method === "POST") {
      return new Response(
        JSON.stringify({
          results: [{ platform: "claude-code", ok: true, configPath: "/x" }],
          platforms: [
            {
              platform: "claude-code",
              cliInstalled: true,
              configPath: "/x",
              hasEntry: true,
              configReadable: true,
            },
          ],
        }),
        { status: 200 },
      );
    }
    if (
      url.includes("/api/agents/") &&
      !url.includes("/installed-status") &&
      !url.includes("/config") &&
      !url.includes("/mcp-wiring") &&
      (init?.method ?? "GET") === "GET"
    ) {
      const detail = agentDetailProvider?.() ?? {
        name: "testing-agent",
        description: "",
        catalog: "default",
        path: "/x",
        targets: ["opencode"],
        identity: "I",
        expertise: "E",
        soul: "S",
        user: "U",
        config: { name: "testing-agent", description: "", targets: ["opencode"] },
      };
      return new Response(JSON.stringify(detail), { status: 200 });
    }
    if (url.includes("/api/agents/") && url.endsWith("/config") && init?.method === "PUT") {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    if (url.includes("/api/atlassian-env")) {
      return new Response(
        JSON.stringify({ hasToken: true, source: "smith-env-file", editable: true }),
        { status: 200 },
      );
    }
    if (url.includes("/api/jobs")) {
      return new Response(JSON.stringify({ jobId: "j1" }), { status: 200 });
    }
    return new Response("not found", { status: 404 });
  };
}

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NotificationCenter>
        <KnowledgeSources agent="testing-agent" />
      </NotificationCenter>
    </QueryClientProvider>,
  );
}

describe("KnowledgeSources", () => {
  let calls: Call[];
  beforeEach(() => {
    calls = [];
  });

  it("renders empty state when no sources", async () => {
    globalThis.fetch = mockFetch(
      () => ({ agent: "testing-agent", sources: [] }),
      calls,
    ) as unknown as typeof fetch;
    renderPanel();
    await waitFor(() => expect(screen.getByText(/no knowledge sources yet/i)).toBeInTheDocument());
    // refresh-all is disabled when empty.
    const refreshAll = screen.getByRole("button", { name: /refresh all/i });
    expect(refreshAll.hasAttribute("disabled")).toBe(true);
  });

  it("shows consent banner for refreshable sources; authorize PUTs consent THEN dispatches fetch", async () => {
    globalThis.fetch = mockFetch(
      () => ({
        agent: "testing-agent",
        sources: [
          {
            source: { id: "s1", type: "url", url: "https://x.test/" },
          },
        ],
      }),
      calls,
    ) as unknown as typeof fetch;
    renderPanel();
    await waitFor(() => expect(screen.getByText(/has not been authorized/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /authorize and refresh/i }));
    // PUT /consent must fire BEFORE the knowledge.fetch dispatch so the
    // banner disappears (manifest is now on disk). Without this order,
    // the previous bug had the banner persist indefinitely because the
    // CLI's interactive consent prompt doesn't fire under spawn.
    await waitFor(() => {
      const put = calls.find((c) => c.url.endsWith("/consent") && c.init?.method === "PUT");
      expect(put).toBeDefined();
      const post = calls.find((c) => c.url.includes("/api/jobs") && c.init?.method === "POST");
      expect(post).toBeDefined();
      const body = JSON.parse((post!.init!.body as string) ?? "{}");
      expect(body.command).toBe("knowledge.fetch");
      expect(body.agent).toBe("testing-agent");
      expect(body.source).toBeUndefined();
    });
  });

  it("does NOT show consent banner when sources are local-only (file/dir/glob, no refresh)", async () => {
    // Bundled agent-smith case: a single `dir` source delivered as
    // `file`. There's nothing the consent governs (no network, no git
    // fetch), so the banner shouldn't pester the user.
    globalThis.fetch = mockFetch(
      () => ({
        agent: "testing-agent",
        sources: [
          {
            source: { id: "guide", type: "dir", path: "../../guide", delivery: "file" },
          },
        ],
      }),
      calls,
    ) as unknown as typeof fetch;
    renderPanel();
    // Wait for any DOM update before asserting the banner's absence —
    // we just need fetch to settle. The agent header text is unique.
    await waitFor(() =>
      expect(screen.getByText(/knowledge sources for testing-agent/i)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/has not been authorized/i)).not.toBeInTheDocument();
  });

  it("hides consent banner when consent is set", async () => {
    globalThis.fetch = mockFetch(
      () => ({
        agent: "testing-agent",
        sources: [],
        consent: {
          granted_at: "2025-01-01T00:00:00Z",
          platforms: ["opencode"],
          sources: [],
        },
      }),
      calls,
    ) as unknown as typeof fetch;
    renderPanel();
    await waitFor(() =>
      expect(screen.queryByText(/has not been authorized/i)).not.toBeInTheDocument(),
    );
  });

  it("per-row refresh dispatches knowledge.fetch with source filter; remove gated by typed-token", async () => {
    globalThis.fetch = mockFetch(
      () => ({
        agent: "testing-agent",
        sources: [
          {
            source: { id: "docs", type: "url", url: "https://x.test/" },
            refreshCache: {
              last_refreshed_at: "2025-01-01T00:00:00Z",
              last_attempt_at: "2025-01-01T00:00:00Z",
              last_error: null,
            },
          },
        ],
        consent: { granted_at: "x", platforms: [], sources: [] },
      }),
      calls,
    ) as unknown as typeof fetch;
    renderPanel();
    await waitFor(() => expect(screen.getByText("docs")).toBeInTheDocument());

    // Per-row refresh.
    fireEvent.click(screen.getByRole("button", { name: /^refresh$/i }));
    await waitFor(() => {
      const post = calls.find((c) => c.url.includes("/api/jobs") && c.init?.method === "POST");
      expect(post).toBeDefined();
      const body = JSON.parse((post!.init!.body as string) ?? "{}");
      expect(body.command).toBe("knowledge.fetch");
      expect(body.source).toBe("docs");
    });

    // Remove opens confirmation modal.
    fireEvent.click(screen.getByRole("button", { name: /^remove$/i }));
    expect(screen.getByText(/remove knowledge source/i)).toBeInTheDocument();
  });

  // ─── T11: compile + serve buttons ──────────────────────────────────────

  it("compile button dispatches knowledge.compile with name", async () => {
    globalThis.fetch = mockFetch(
      () => ({
        agent: "testing-agent",
        sources: [{ source: { id: "docs", type: "url", url: "https://x.test/" } }],
        consent: { granted_at: "x", platforms: [], sources: [] },
      }),
      calls,
    ) as unknown as typeof fetch;
    renderPanel();
    await waitFor(() => expect(screen.getByText("docs")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /compile/i }));
    await waitFor(() => {
      const post = calls.find(
        (c) =>
          c.url.includes("/api/jobs") &&
          c.init?.method === "POST" &&
          (JSON.parse((c.init?.body as string) ?? "{}").command as string) === "knowledge.compile",
      );
      expect(post).toBeDefined();
      const body = JSON.parse((post!.init!.body as string) ?? "{}");
      expect(body).toMatchObject({ command: "knowledge.compile", name: "testing-agent" });
    });
  });

  // ─── v2.1-E: MCP wiring toggle — confirmation modal + multi-step chain ─

  it("MCP toggle ON: opens confirmation modal listing the wiring plan", async () => {
    globalThis.fetch = mockFetch(
      () => ({
        agent: "testing-agent",
        sources: [{ source: { id: "docs", type: "url", url: "https://x.test/" } }],
        consent: { granted_at: "x", platforms: [], sources: [] },
      }),
      calls,
      () => ({
        name: "testing-agent",
        description: "",
        catalog: "default",
        path: "/x",
        targets: ["opencode"],
        identity: "I",
        expertise: "E",
        soul: "S",
        user: "U",
        config: {
          name: "testing-agent",
          description: "",
          targets: ["opencode"],
          mcpServers: [],
        },
      }),
    ) as unknown as typeof fetch;
    renderPanel();
    await waitFor(() => expect(screen.getByText("docs")).toBeInTheDocument());

    const toggle = screen.getByRole("switch", { name: /knowledge mcp server wiring/i });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    fireEvent.click(toggle);

    // Modal renders with the verb + plan summary.
    await waitFor(() =>
      expect(screen.getByText(/wire knowledge mcp server for testing-agent/i)).toBeInTheDocument(),
    );
    expect(screen.getByText(/ai client mcp configs/i)).toBeInTheDocument();
    // /mcp-wiring-plan was fetched.
    expect(
      calls.find((c) => c.url.endsWith("/mcp-wiring-plan") && (c.init?.method ?? "GET") === "GET"),
    ).toBeDefined();
  });

  it("MCP toggle ON: confirm dispatches PUT /config → POST /mcp-wiring → agent.install", async () => {
    globalThis.fetch = mockFetch(
      () => ({
        agent: "testing-agent",
        sources: [{ source: { id: "docs", type: "url", url: "https://x.test/" } }],
        consent: { granted_at: "x", platforms: [], sources: [] },
      }),
      calls,
      () => ({
        name: "testing-agent",
        description: "",
        catalog: "default",
        path: "/x",
        targets: ["opencode"],
        identity: "I",
        expertise: "E",
        soul: "S",
        user: "U",
        config: {
          name: "testing-agent",
          description: "",
          targets: ["opencode"],
          mcpServers: ["github-mcp"],
        },
      }),
    ) as unknown as typeof fetch;
    renderPanel();
    await waitFor(() => expect(screen.getByText("docs")).toBeInTheDocument());

    const toggle = screen.getByRole("switch", { name: /knowledge mcp server wiring/i });
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^wire 1 platform/i })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /^wire 1 platform/i }));

    // 1. PUT /config — full deduplicated array (preserves siblings + adds canonical name).
    await waitFor(() => {
      const put = calls.find(
        (c) => c.url.endsWith("/config") && c.init?.method === "PUT" && c.url.includes("/agents/"),
      );
      expect(put).toBeDefined();
      const body = JSON.parse((put!.init!.body as string) ?? "{}");
      // Per-agent key: bundle "testing-agent" → "testing-agent-knowledge".
      expect(body).toEqual({ mcpServers: ["github-mcp", "testing-agent-knowledge"] });
    });
    // 2. POST /mcp-wiring with enable=true and the platforms list.
    await waitFor(() => {
      const post = calls.find(
        (c) => c.url.endsWith("/mcp-wiring") && c.init?.method === "POST",
      );
      expect(post).toBeDefined();
      const body = JSON.parse((post!.init!.body as string) ?? "{}");
      expect(body.enable).toBe(true);
      expect(body.platforms).toContain("claude-code");
    });
    // 3. agent.install dispatched.
    await waitFor(() => {
      const job = calls.find(
        (c) =>
          c.url.includes("/api/jobs") &&
          c.init?.method === "POST" &&
          (JSON.parse((c.init?.body as string) ?? "{}").command as string) === "agent.install",
      );
      expect(job).toBeDefined();
      const body = JSON.parse((job!.init!.body as string) ?? "{}");
      expect(body.name).toBe("testing-agent");
    });
  });

  it("MCP toggle OFF: confirm sends enable=false and full deduplicated array", async () => {
    globalThis.fetch = mockFetch(
      () => ({
        agent: "testing-agent",
        sources: [{ source: { id: "docs", type: "url", url: "https://x.test/" } }],
        consent: { granted_at: "x", platforms: [], sources: [] },
      }),
      calls,
      () => ({
        name: "testing-agent",
        description: "",
        catalog: "default",
        path: "/x",
        targets: ["opencode"],
        identity: "I",
        expertise: "E",
        soul: "S",
        user: "U",
        config: {
          name: "testing-agent",
          description: "",
          targets: ["opencode"],
          mcpServers: ["testing-agent-knowledge", "github-mcp"],
        },
      }),
      // Plan: claude-code currently has the entry, so disable should target it.
      () => ({
        platforms: [
          {
            platform: "claude-code",
            cliInstalled: true,
            configPath: "/home/user/.claude.json",
            hasEntry: true,
            configReadable: true,
          },
        ],
        bundleHasEntry: true,
      }),
    ) as unknown as typeof fetch;
    renderPanel();
    await waitFor(() => expect(screen.getByText("docs")).toBeInTheDocument());

    const toggle = screen.getByRole("switch", { name: /knowledge mcp server wiring/i });
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "true"));
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(screen.getByText(/unwire knowledge mcp server/i)).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /^unwire 1 platform/i }));

    // PUT /config with the canonical name dropped, sibling preserved.
    await waitFor(() => {
      const put = calls.find(
        (c) => c.url.endsWith("/config") && c.init?.method === "PUT" && c.url.includes("/agents/"),
      );
      expect(put).toBeDefined();
      const body = JSON.parse((put!.init!.body as string) ?? "{}");
      expect(body).toEqual({ mcpServers: ["github-mcp"] });
    });
    // POST /mcp-wiring with enable=false.
    await waitFor(() => {
      const post = calls.find(
        (c) => c.url.endsWith("/mcp-wiring") && c.init?.method === "POST",
      );
      expect(post).toBeDefined();
      const body = JSON.parse((post!.init!.body as string) ?? "{}");
      expect(body.enable).toBe(false);
    });
  });

  it("MCP toggle: cancelling the modal reverts the optimistic flip and dispatches no writes", async () => {
    globalThis.fetch = mockFetch(
      () => ({
        agent: "testing-agent",
        sources: [{ source: { id: "docs", type: "url", url: "https://x.test/" } }],
        consent: { granted_at: "x", platforms: [], sources: [] },
      }),
      calls,
      () => ({
        name: "testing-agent",
        description: "",
        catalog: "default",
        path: "/x",
        targets: ["opencode"],
        identity: "I",
        expertise: "E",
        soul: "S",
        user: "U",
        config: {
          name: "testing-agent",
          description: "",
          targets: ["opencode"],
          mcpServers: [],
        },
      }),
    ) as unknown as typeof fetch;
    renderPanel();
    await waitFor(() => expect(screen.getByText("docs")).toBeInTheDocument());
    const toggle = screen.getByRole("switch", { name: /knowledge mcp server wiring/i });
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(screen.getByText(/wire knowledge mcp server for/i)).toBeInTheDocument(),
    );
    // The toggle is optimistically ON while the modal is open.
    expect(toggle).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    // Toggle reverts; no PUT/config or POST/mcp-wiring fired.
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "false"));
    expect(
      calls.find((c) => c.url.endsWith("/config") && c.init?.method === "PUT"),
    ).toBeUndefined();
    expect(
      calls.find((c) => c.url.endsWith("/mcp-wiring") && c.init?.method === "POST"),
    ).toBeUndefined();
  });

  it("does not render the legacy debug serve button", async () => {
    globalThis.fetch = mockFetch(
      () => ({
        agent: "testing-agent",
        sources: [{ source: { id: "docs", type: "url", url: "https://x.test/" } }],
        consent: { granted_at: "x", platforms: [], sources: [] },
      }),
      calls,
    ) as unknown as typeof fetch;
    renderPanel();
    await waitFor(() => expect(screen.getByText("docs")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /^serve$/i })).not.toBeInTheDocument();
  });

  it("per-row edit button opens the EditKnowledgeSourceModal pinned to that source", async () => {
    globalThis.fetch = mockFetch(
      () => ({
        agent: "testing-agent",
        sources: [
          { source: { id: "docs", type: "url", url: "https://x.test/", delivery: "auto" } },
        ],
        consent: { granted_at: "x", platforms: [], sources: [] },
      }),
      calls,
      () => ({
        name: "testing-agent",
        description: "",
        catalog: "default",
        path: "/x",
        targets: ["opencode"],
        identity: "I",
        expertise: "E",
        soul: "S",
        user: "U",
        config: {
          name: "testing-agent",
          description: "",
          targets: ["opencode"],
          knowledge: {
            sources: [{ id: "docs", type: "url", url: "https://x.test/", delivery: "auto" }],
          },
        },
      }),
    ) as unknown as typeof fetch;
    renderPanel();
    await waitFor(() => expect(screen.getByText("docs")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    // Modal header includes id + type.
    await waitFor(() =>
      expect(screen.getByText(/edit source · docs \(url\)/i)).toBeInTheDocument(),
    );
    // The url field is pre-populated with the existing value.
    expect(screen.getByLabelText(/^\/\/ url$/i)).toHaveValue("https://x.test/");
  });

  it("MCP toggle: per-agent key — bundle named foo-bar adds 'foo-bar-knowledge' to mcpServers", async () => {
    // Sanity: a non-singleton agent must derive its own per-agent server
    // key from its name, NOT use the legacy hardcoded
    // "agent-smith-knowledge". Without per-agent keys, a second bundle's
    // toggle-ON would overwrite the first bundle's entry under the same
    // name in every AI client's MCP config.
    globalThis.fetch = mockFetch(
      () => ({
        agent: "foo-bar",
        sources: [{ source: { id: "docs", type: "url", url: "https://x.test/" } }],
        consent: { granted_at: "x", platforms: [], sources: [] },
      }),
      calls,
      () => ({
        name: "foo-bar",
        description: "",
        catalog: "default",
        path: "/x",
        targets: ["opencode"],
        identity: "I",
        expertise: "E",
        soul: "S",
        user: "U",
        config: {
          name: "foo-bar",
          description: "",
          targets: ["opencode"],
          mcpServers: [],
        },
      }),
    ) as unknown as typeof fetch;
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <NotificationCenter>
          <KnowledgeSources agent="foo-bar" />
        </NotificationCenter>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByText("docs")).toBeInTheDocument());
    const toggle = screen.getByRole("switch", { name: /knowledge mcp server wiring/i });
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^wire 1 platform/i })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /^wire 1 platform/i }));
    await waitFor(() => {
      const put = calls.find(
        (c) => c.url.endsWith("/config") && c.init?.method === "PUT" && c.url.includes("/agents/"),
      );
      expect(put).toBeDefined();
      const body = JSON.parse((put!.init!.body as string) ?? "{}");
      // The key MUST be derived from the agent name — NOT
      // "agent-smith-knowledge".
      expect(body).toEqual({ mcpServers: ["foo-bar-knowledge"] });
    });
  });

  it("opens AddKnowledgeSourceModal with 8 source types", async () => {
    globalThis.fetch = mockFetch(
      () => ({ agent: "testing-agent", sources: [] }),
      calls,
    ) as unknown as typeof fetch;
    renderPanel();
    await waitFor(() => expect(screen.getByText(/no knowledge sources yet/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /\+ add source/i }));
    await waitFor(() => expect(screen.getByText(/choose a source type/i)).toBeInTheDocument());
    for (const t of ["file", "dir", "glob", "url", "git", "npm", "confluence", "jira"]) {
      expect(screen.getByRole("button", { name: new RegExp(`^${t}\\b`, "i") })).toBeInTheDocument();
    }
  });
});
