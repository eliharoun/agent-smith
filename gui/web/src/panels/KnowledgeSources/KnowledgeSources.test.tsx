import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
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
    if (
      url.includes("/api/agents/") &&
      !url.includes("/installed-status") &&
      !url.includes("/config") &&
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
      <KnowledgeSources agent="testing-agent" />
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

    // Remove opens typed-token modal.
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

  // ─── v2.1-D: MCP wiring toggle (replaces the fire-and-forget serve btn) ─

  it("MCP toggle ON: PUTs mcpServers patch with the canonical name appended to the array", async () => {
    // Start with an empty mcpServers array in agent detail. Toggle is OFF.
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

    await waitFor(() => {
      const put = calls.find(
        (c) => c.url.endsWith("/config") && c.init?.method === "PUT" && c.url.includes("/agents/"),
      );
      expect(put).toBeDefined();
      const body = JSON.parse((put!.init!.body as string) ?? "{}");
      expect(body).toEqual({ mcpServers: ["agent-smith-knowledge"] });
    });
    // ON banner appears after a successful save with the two-step copy.
    await waitFor(() =>
      expect(screen.getByText(/two steps to finish wiring/i)).toBeInTheDocument(),
    );
    expect(screen.getByText(/smith agent install testing-agent/i)).toBeInTheDocument();
    expect(screen.getByText(/knowledge serve testing-agent --stdio/i)).toBeInTheDocument();
  });

  it("MCP toggle ON: preserves any pre-existing names in the array (dedupes the canonical name)", async () => {
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
    expect(toggle).toHaveAttribute("aria-checked", "false");
    fireEvent.click(toggle);

    await waitFor(() => {
      const put = calls.find(
        (c) => c.url.endsWith("/config") && c.init?.method === "PUT" && c.url.includes("/agents/"),
      );
      expect(put).toBeDefined();
      const body = JSON.parse((put!.init!.body as string) ?? "{}");
      expect(body).toEqual({ mcpServers: ["github-mcp", "agent-smith-knowledge"] });
    });
  });

  it("MCP toggle OFF: removes the canonical name but preserves other entries in the array", async () => {
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
          mcpServers: ["agent-smith-knowledge", "github-mcp"],
        },
      }),
    ) as unknown as typeof fetch;
    renderPanel();
    await waitFor(() => expect(screen.getByText("docs")).toBeInTheDocument());

    const toggle = screen.getByRole("switch", { name: /knowledge mcp server wiring/i });
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "true"));
    fireEvent.click(toggle);

    await waitFor(() => {
      const put = calls.find(
        (c) => c.url.endsWith("/config") && c.init?.method === "PUT" && c.url.includes("/agents/"),
      );
      expect(put).toBeDefined();
      const body = JSON.parse((put!.init!.body as string) ?? "{}");
      // Sibling preserved; agent-smith-knowledge removed.
      expect(body).toEqual({ mcpServers: ["github-mcp"] });
    });
    // OFF banner is the simpler one-liner.
    await waitFor(() =>
      expect(screen.getByText(/knowledge mcp server disabled\. run/i)).toBeInTheDocument(),
    );
  });

  it("MCP toggle OFF with no other entries sends an empty array", async () => {
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
          mcpServers: ["agent-smith-knowledge"],
        },
      }),
    ) as unknown as typeof fetch;
    renderPanel();
    await waitFor(() => expect(screen.getByText("docs")).toBeInTheDocument());
    const toggle = screen.getByRole("switch", { name: /knowledge mcp server wiring/i });
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "true"));
    fireEvent.click(toggle);
    await waitFor(() => {
      const put = calls.find(
        (c) => c.url.endsWith("/config") && c.init?.method === "PUT" && c.url.includes("/agents/"),
      );
      expect(put).toBeDefined();
      const body = JSON.parse((put!.init!.body as string) ?? "{}");
      expect(body).toEqual({ mcpServers: [] });
    });
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
