import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { KnowledgeSource, McpServerAndToolsView, Platform } from "gui-shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationCenter } from "@/ui/NotificationCenter";
import { EditKnowledgeSourceModal } from "./EditKnowledgeSourceModal";

type Call = { url: string; init?: RequestInit | undefined };

function mockFetch(
  calls: Call[],
  opts: {
    putStatus?: number;
    picker?: McpServerAndToolsView;
    /** When set, GET cache-status returns this body. Default false. */
    cacheStatus?: { hasCachedFiles: boolean };
    /** When set, DELETE cache returns this status. Default 204. */
    deleteCacheStatus?: number;
    /** When set, GET drift-check returns this body. Default empty drift. */
    drift?: { drifted: Platform[] };
  } = {},
) {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({ url, init });
    if (url.endsWith("/mcp-servers-and-tools")) {
      const empty: McpServerAndToolsView = { servers: [], toolsByServer: {} };
      return new Response(JSON.stringify(opts.picker ?? empty), { status: 200 });
    }
    if (url.includes("/drift-check")) {
      return new Response(JSON.stringify(opts.drift ?? { drifted: [] }), { status: 200 });
    }
    if (url.includes("/cache-status")) {
      return new Response(JSON.stringify(opts.cacheStatus ?? { hasCachedFiles: false }), {
        status: 200,
      });
    }
    if (url.endsWith("/cache") && init?.method === "DELETE") {
      return new Response(null, { status: opts.deleteCacheStatus ?? 204 });
    }
    if (url.includes("/api/agents/") && init?.method === "PUT") {
      return new Response(JSON.stringify({ ok: true }), { status: opts.putStatus ?? 200 });
    }
    return new Response("not found", { status: 404 });
  };
}

function noopReinstall(_targets: Platform[]): void {
  // default no-op for tests that don't care about the action
  void _targets;
}

function wrap(node: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NotificationCenter>{node}</NotificationCenter>
    </QueryClientProvider>,
  );
}

describe("EditKnowledgeSourceModal", () => {
  let calls: Call[];
  beforeEach(() => {
    calls = [];
  });

  it("pre-populates from the existing source and pins type/id", () => {
    globalThis.fetch = mockFetch(calls) as unknown as typeof fetch;
    const src: KnowledgeSource = {
      id: "docs",
      type: "url",
      url: "https://example.com/x",
      delivery: "auto",
    };
    wrap(
      <EditKnowledgeSourceModal
        agent="a1"
        existingSource={src}
        knowledgeBlock={{ sources: [src] }}
        onClose={() => {}}
      />,
    );
    // header shows id + type, no type selector visible.
    expect(screen.getByText(/docs \(url\)/)).toBeInTheDocument();
    // url field is pre-populated.
    expect(screen.getByLabelText(/^\/\/ url$/i)).toHaveValue("https://example.com/x");
    // Save is disabled because nothing is dirty.
    const save = screen.getByRole("button", { name: /^save$/i });
    expect(save.hasAttribute("disabled")).toBe(true);
  });

  it("PUTs the full knowledge block on save with the source replaced by id", async () => {
    globalThis.fetch = mockFetch(calls) as unknown as typeof fetch;
    const a: KnowledgeSource = {
      id: "docs",
      type: "url",
      url: "https://example.com/x",
      delivery: "auto",
    };
    const b: KnowledgeSource = {
      id: "other",
      type: "file",
      path: "/tmp/x.md",
      delivery: "auto",
    };
    wrap(
      <EditKnowledgeSourceModal
        agent="a1"
        existingSource={a}
        knowledgeBlock={{
          packs: ["base"],
          inlineBudget: { totalTokens: 8000 },
          sources: [a, b],
          compile: { progressive: true },
        }}
        onClose={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText(/^\/\/ url$/i), {
      target: { value: "https://example.com/y" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => {
      const put = calls.find(
        (c) => c.url.includes("/api/agents/a1/config") && c.init?.method === "PUT",
      );
      expect(put).toBeDefined();
    });
    const put = calls.find(
      (c) => c.url.includes("/api/agents/a1/config") && c.init?.method === "PUT",
    )!;
    const body = JSON.parse(put.init!.body as string);
    expect(body.knowledge.packs).toEqual(["base"]);
    expect(body.knowledge.inlineBudget).toEqual({ totalTokens: 8000 });
    expect(body.knowledge.compile).toEqual({ progressive: true });
    // Two sources, one replaced (docs), one untouched (other).
    expect(body.knowledge.sources).toHaveLength(2);
    const docs = body.knowledge.sources.find((s: { id: string }) => s.id === "docs");
    expect(docs.url).toBe("https://example.com/y");
    const other = body.knowledge.sources.find((s: { id: string }) => s.id === "other");
    expect(other.path).toBe("/tmp/x.md");
  });

  it("surfaces v2 fields (delivery, summary, toc, retrieval) and round-trips them", async () => {
    globalThis.fetch = mockFetch(calls) as unknown as typeof fetch;
    const src: KnowledgeSource = {
      id: "docs",
      type: "url",
      url: "https://example.com/x",
      delivery: "auto",
    };
    wrap(
      <EditKnowledgeSourceModal
        agent="a1"
        existingSource={src}
        knowledgeBlock={{ sources: [src] }}
        onClose={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText(/^\/\/ delivery$/i), { target: { value: "file" } });
    fireEvent.change(screen.getByLabelText(/^\/\/ summary/i), {
      target: { value: "team docs" },
    });
    fireEvent.change(screen.getByLabelText(/^\/\/ include in compile toc$/i), {
      target: { value: "yes" },
    });
    fireEvent.change(screen.getByLabelText(/^\/\/ retrieval mode$/i), {
      target: { value: "bm25" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => {
      expect(
        calls.find((c) => c.url.includes("/api/agents/") && c.init?.method === "PUT"),
      ).toBeDefined();
    });
    const put = calls.find((c) => c.url.includes("/api/agents/") && c.init?.method === "PUT")!;
    const body = JSON.parse(put.init!.body as string);
    expect(body.knowledge.sources[0]).toMatchObject({
      id: "docs",
      type: "url",
      delivery: "file",
      summary: "team docs",
      toc: true,
    });
    // bm25 is the default; should NOT be written to disk when set to default value.
    expect("retrieval" in body.knowledge.sources[0]).toBe(false);
  });

  it("round-trips the via field on save (regression: silent strip)", async () => {
    globalThis.fetch = mockFetch(calls) as unknown as typeof fetch;
    // A source authored elsewhere with a routing declaration. The modal
    // doesn't surface `via` as an input, but it MUST survive an edit.
    const src = {
      id: "docs",
      type: "url",
      url: "https://example.com/x",
      delivery: "auto",
      via: { server: "x-mcp", tool: "fetch_thing" },
      lazy: true,
    } as unknown as KnowledgeSource;
    wrap(
      <EditKnowledgeSourceModal
        agent="a1"
        existingSource={src}
        knowledgeBlock={{ sources: [src] }}
        onClose={() => {}}
      />,
    );
    // User edits an unrelated field.
    fireEvent.change(screen.getByLabelText(/^\/\/ description$/i), {
      target: { value: "team docs" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => {
      expect(
        calls.find((c) => c.url.includes("/api/agents/") && c.init?.method === "PUT"),
      ).toBeDefined();
    });
    const put = calls.find((c) => c.url.includes("/api/agents/") && c.init?.method === "PUT")!;
    const body = JSON.parse(put.init!.body as string);
    const written = body.knowledge.sources[0];
    expect(written.description).toBe("team docs");
    expect(written.via).toEqual({ server: "x-mcp", tool: "fetch_thing" });
    expect(written.lazy).toBe(true);
  });

  it("displays current via when opening a routed source", async () => {
    globalThis.fetch = mockFetch(calls, {
      picker: {
        servers: [{ name: "x-mcp", source: "bundle" }],
        toolsByServer: {
          "x-mcp": [{ name: "fetch_thing", urlParam: { kind: "string", key: "url" } }],
        },
      },
    }) as unknown as typeof fetch;
    const src = {
      id: "docs",
      type: "url",
      url: "https://example.com/x",
      delivery: "auto",
      via: { server: "x-mcp", tool: "fetch_thing" },
    } as unknown as KnowledgeSource;
    wrap(
      <EditKnowledgeSourceModal
        agent="a1"
        existingSource={src}
        knowledgeBlock={{ sources: [src] }}
        mcpServers={["x-mcp"]}
        onClose={() => {}}
      />,
    );
    // Server dropdown shows the current pick selected.
    const select = await screen.findByRole("combobox", { name: /route through MCP server/i });
    await waitFor(() => expect((select as HTMLSelectElement).value).toBe("x-mcp"));
    // Single-tool server: route hint shown inline (no sub-picker).
    expect(await screen.findByText(/routing through x-mcp\.fetch_thing/)).toBeInTheDocument();
  });

  it("switching to '(none)' clears via on save", async () => {
    globalThis.fetch = mockFetch(calls, {
      picker: {
        servers: [{ name: "x-mcp", source: "bundle" }],
        toolsByServer: {
          "x-mcp": [{ name: "fetch_thing", urlParam: { kind: "string", key: "url" } }],
        },
      },
    }) as unknown as typeof fetch;
    const src = {
      id: "docs",
      type: "url",
      url: "https://example.com/x",
      delivery: "auto",
      via: { server: "x-mcp", tool: "fetch_thing" },
    } as unknown as KnowledgeSource;
    wrap(
      <EditKnowledgeSourceModal
        agent="a1"
        existingSource={src}
        knowledgeBlock={{ sources: [src] }}
        mcpServers={["x-mcp"]}
        onClose={() => {}}
      />,
    );
    const select = await screen.findByRole("combobox", { name: /route through MCP server/i });
    await waitFor(() => expect((select as HTMLSelectElement).value).toBe("x-mcp"));
    fireEvent.change(select, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => {
      expect(
        calls.find((c) => c.url.includes("/api/agents/") && c.init?.method === "PUT"),
      ).toBeDefined();
    });
    const put = calls.find((c) => c.url.includes("/api/agents/") && c.init?.method === "PUT")!;
    const body = JSON.parse(put.init!.body as string);
    const written = body.knowledge.sources[0];
    // `via` field omitted entirely (not `null`).
    expect("via" in written).toBe(false);
  });

  it("switching to a different server updates via on save", async () => {
    globalThis.fetch = mockFetch(calls, {
      picker: {
        servers: [
          { name: "alpha-mcp", source: "bundle" },
          { name: "beta-mcp", source: "bundle" },
        ],
        toolsByServer: {
          "alpha-mcp": [{ name: "fetch", urlParam: { kind: "string", key: "url" } }],
          "beta-mcp": [{ name: "scrape", urlParam: { kind: "string", key: "url" } }],
        },
      },
    }) as unknown as typeof fetch;
    const src = {
      id: "docs",
      type: "url",
      url: "https://example.com/x",
      delivery: "auto",
      via: { server: "alpha-mcp", tool: "fetch" },
    } as unknown as KnowledgeSource;
    wrap(
      <EditKnowledgeSourceModal
        agent="a1"
        existingSource={src}
        knowledgeBlock={{ sources: [src] }}
        mcpServers={["alpha-mcp", "beta-mcp"]}
        onClose={() => {}}
      />,
    );
    const select = await screen.findByRole("combobox", { name: /route through MCP server/i });
    await waitFor(() => expect((select as HTMLSelectElement).value).toBe("alpha-mcp"));
    fireEvent.change(select, { target: { value: "beta-mcp" } });
    // Single-tool auto-resolves; route hint flips.
    await screen.findByText(/routing through beta-mcp\.scrape/);
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => {
      expect(
        calls.find((c) => c.url.includes("/api/agents/") && c.init?.method === "PUT"),
      ).toBeDefined();
    });
    const put = calls.find((c) => c.url.includes("/api/agents/") && c.init?.method === "PUT")!;
    const body = JSON.parse(put.init!.body as string);
    const written = body.knowledge.sources[0];
    expect(written.via).toEqual({ server: "beta-mcp", tool: "scrape" });
    // beta-mcp already declared in mcpServers — no patch needed.
    expect(body.mcpServers).toBeUndefined();
  });

  it("shows [not configured] badge when via.server not in user's MCP config", async () => {
    globalThis.fetch = mockFetch(calls, {
      // The fetched picker does NOT contain ghost-mcp.
      picker: {
        servers: [{ name: "alpha-mcp", source: "bundle" }],
        toolsByServer: {
          "alpha-mcp": [{ name: "fetch", urlParam: { kind: "string", key: "url" } }],
        },
      },
    }) as unknown as typeof fetch;
    const src = {
      id: "docs",
      type: "url",
      url: "https://example.com/x",
      delivery: "auto",
      via: { server: "ghost-mcp", tool: "fetch_thing" },
    } as unknown as KnowledgeSource;
    wrap(
      <EditKnowledgeSourceModal
        agent="a1"
        existingSource={src}
        knowledgeBlock={{ sources: [src] }}
        mcpServers={[]} // not declared anywhere
        onClose={() => {}}
      />,
    );
    const select = await screen.findByRole("combobox", { name: /route through MCP server/i });
    await waitFor(() => expect((select as HTMLSelectElement).value).toBe("ghost-mcp"));
    // The ghost option is rendered with the "[not configured]" badge.
    const ghostOption = Array.from(select.querySelectorAll("option")).find((o) =>
      (o.textContent ?? "").includes("ghost-mcp"),
    );
    expect(ghostOption?.textContent).toMatch(/not configured/);
  });

  it("extends mcpServers[] when picking a server not yet declared", async () => {
    globalThis.fetch = mockFetch(calls, {
      picker: {
        servers: [
          { name: "alpha-mcp", source: "bundle" },
          { name: "ai-only-mcp", source: "available" },
        ],
        toolsByServer: {
          "alpha-mcp": [{ name: "fetch", urlParam: { kind: "string", key: "url" } }],
          "ai-only-mcp": [{ name: "lookup", urlParam: { kind: "string", key: "url" } }],
        },
      },
    }) as unknown as typeof fetch;
    const src = {
      id: "docs",
      type: "url",
      url: "https://example.com/x",
      delivery: "auto",
      via: { server: "alpha-mcp", tool: "fetch" },
    } as unknown as KnowledgeSource;
    wrap(
      <EditKnowledgeSourceModal
        agent="a1"
        existingSource={src}
        knowledgeBlock={{ sources: [src] }}
        mcpServers={["alpha-mcp"]} // ai-only-mcp NOT declared yet
        onClose={() => {}}
      />,
    );
    const select = await screen.findByRole("combobox", { name: /route through MCP server/i });
    await waitFor(() => expect((select as HTMLSelectElement).value).toBe("alpha-mcp"));
    fireEvent.change(select, { target: { value: "ai-only-mcp" } });
    await screen.findByText(/routing through ai-only-mcp\.lookup/);
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => {
      expect(
        calls.find((c) => c.url.includes("/api/agents/") && c.init?.method === "PUT"),
      ).toBeDefined();
    });
    const put = calls.find((c) => c.url.includes("/api/agents/") && c.init?.method === "PUT")!;
    const body = JSON.parse(put.init!.body as string);
    expect(body.mcpServers).toEqual(["alpha-mcp", "ai-only-mcp"]);
    expect(body.knowledge.sources[0].via).toEqual({ server: "ai-only-mcp", tool: "lookup" });
  });

  it("requires retrieval.mcpUrl when retrieval mode is external-mcp", () => {
    globalThis.fetch = mockFetch(calls) as unknown as typeof fetch;
    const src: KnowledgeSource = {
      id: "docs",
      type: "url",
      url: "https://example.com/x",
      delivery: "auto",
    };
    wrap(
      <EditKnowledgeSourceModal
        agent="a1"
        existingSource={src}
        knowledgeBlock={{ sources: [src] }}
        onClose={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText(/^\/\/ retrieval mode$/i), {
      target: { value: "external-mcp" },
    });
    // mcpUrl field appears now and Save is disabled.
    const mcp = screen.getByLabelText(/^\/\/ retrieval\.mcpUrl$/i);
    expect(mcp).toBeInTheDocument();
    const save = screen.getByRole("button", { name: /^save$/i });
    expect(save.hasAttribute("disabled")).toBe(true);
  });

  it("persists retrieval mode hybrid without requiring mcpUrl", async () => {
    globalThis.fetch = mockFetch(calls) as unknown as typeof fetch;
    const src: KnowledgeSource = {
      id: "docs",
      type: "url",
      url: "https://example.com/x",
      delivery: "auto",
    };
    wrap(
      <EditKnowledgeSourceModal
        agent="a1"
        existingSource={src}
        knowledgeBlock={{ sources: [src] }}
        onClose={() => {}}
      />,
    );
    // The dropdown offers a hybrid option.
    const select = screen.getByLabelText(/^\/\/ retrieval mode$/i) as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toContain("hybrid");
    fireEvent.change(select, { target: { value: "hybrid" } });
    // hybrid needs no mcpUrl — no field shown and Save is enabled.
    expect(screen.queryByLabelText(/^\/\/ retrieval\.mcpUrl$/i)).not.toBeInTheDocument();
    const save = screen.getByRole("button", { name: /^save$/i });
    expect(save.hasAttribute("disabled")).toBe(false);
    fireEvent.click(save);
    await waitFor(() => {
      expect(
        calls.find((c) => c.url.includes("/api/agents/") && c.init?.method === "PUT"),
      ).toBeDefined();
    });
    const put = calls.find((c) => c.url.includes("/api/agents/") && c.init?.method === "PUT")!;
    const body = JSON.parse(put.init!.body as string);
    const written = body.knowledge.sources[0];
    // hybrid is non-default, so it IS written — with no mcpUrl.
    expect(written.retrieval).toEqual({ mode: "hybrid" });
  });

  it("validates refresh.ttl format when refresh mode is ttl", () => {
    globalThis.fetch = mockFetch(calls) as unknown as typeof fetch;
    const src: KnowledgeSource = {
      id: "docs",
      type: "url",
      url: "https://example.com/x",
      delivery: "auto",
    };
    wrap(
      <EditKnowledgeSourceModal
        agent="a1"
        existingSource={src}
        knowledgeBlock={{ sources: [src] }}
        onClose={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText(/^\/\/ refresh mode$/i), { target: { value: "ttl" } });
    fireEvent.change(screen.getByLabelText(/^\/\/ refresh ttl/i), {
      target: { value: "garbage" },
    });
    expect(screen.getByText(/30m, 2h, 1d, 1w/i)).toBeInTheDocument();
    const save = screen.getByRole("button", { name: /^save$/i });
    expect(save.hasAttribute("disabled")).toBe(true);
  });

  it("confirms before discarding when dirty (cancel button)", () => {
    globalThis.fetch = mockFetch(calls) as unknown as typeof fetch;
    const src: KnowledgeSource = {
      id: "docs",
      type: "file",
      path: "/x",
      delivery: "auto",
    };
    let closed = 0;
    wrap(
      <EditKnowledgeSourceModal
        agent="a1"
        existingSource={src}
        knowledgeBlock={{ sources: [src] }}
        onClose={() => {
          closed++;
        }}
      />,
    );
    fireEvent.change(screen.getByLabelText(/^\/\/ path$/i), { target: { value: "/y" } });
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    // Confirm dialog shown; close not yet called.
    expect(screen.getByText(/discard unsaved changes/i)).toBeInTheDocument();
    expect(closed).toBe(0);
    // Confirm "Discard" closes.
    fireEvent.click(screen.getByRole("button", { name: /^discard$/i }));
    expect(closed).toBe(1);
  });

  it("closes immediately when not dirty", () => {
    globalThis.fetch = mockFetch(calls) as unknown as typeof fetch;
    const src: KnowledgeSource = {
      id: "docs",
      type: "file",
      path: "/x",
      delivery: "auto",
    };
    let closed = 0;
    wrap(
      <EditKnowledgeSourceModal
        agent="a1"
        existingSource={src}
        knowledgeBlock={{ sources: [src] }}
        onClose={() => {
          closed++;
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(closed).toBe(1);
    expect(screen.queryByText(/discard unsaved changes/i)).not.toBeInTheDocument();
  });

  it("dir source: round-trips include/exclude lines", async () => {
    globalThis.fetch = mockFetch(calls) as unknown as typeof fetch;
    const src: KnowledgeSource = {
      id: "notes",
      type: "dir",
      path: "/notes",
      delivery: "auto",
      include: ["**/*.md"],
    };
    wrap(
      <EditKnowledgeSourceModal
        agent="a1"
        existingSource={src}
        knowledgeBlock={{ sources: [src] }}
        onClose={() => {}}
      />,
    );
    // include is pre-populated; add an exclude line.
    fireEvent.change(screen.getByLabelText(/^\/\/ exclude/i), {
      target: { value: "**/*.tmp\nnode_modules/**" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => {
      expect(
        calls.find((c) => c.url.includes("/api/agents/") && c.init?.method === "PUT"),
      ).toBeDefined();
    });
    const put = calls.find((c) => c.url.includes("/api/agents/") && c.init?.method === "PUT")!;
    const body = JSON.parse(put.init!.body as string);
    expect(body.knowledge.sources[0]).toMatchObject({
      id: "notes",
      type: "dir",
      include: ["**/*.md"],
      exclude: ["**/*.tmp", "node_modules/**"],
    });
  });

  it("static type (dir): refresh-mode dropdown only offers install", () => {
    globalThis.fetch = mockFetch(calls) as unknown as typeof fetch;
    const src: KnowledgeSource = {
      id: "notes",
      type: "dir",
      path: "/notes",
      delivery: "auto",
    };
    wrap(
      <EditKnowledgeSourceModal
        agent="a1"
        existingSource={src}
        knowledgeBlock={{ sources: [src] }}
        onClose={() => {}}
      />,
    );
    const select = screen.getByLabelText(/^\/\/ refresh mode$/i) as HTMLSelectElement;
    const offered = Array.from(select.options).map((o) => o.value);
    // Only the empty-default and "install" options are valid for static types.
    expect(offered).toEqual(["", "install"]);
    expect(offered).not.toContain("ttl");
    expect(offered).not.toContain("session");
    expect(offered).not.toContain("always");
  });

  it("dynamic type (url): refresh-mode dropdown offers all four modes", () => {
    globalThis.fetch = mockFetch(calls) as unknown as typeof fetch;
    const src: KnowledgeSource = {
      id: "docs",
      type: "url",
      url: "https://example.com/x",
      delivery: "auto",
    };
    wrap(
      <EditKnowledgeSourceModal
        agent="a1"
        existingSource={src}
        knowledgeBlock={{ sources: [src] }}
        onClose={() => {}}
      />,
    );
    const select = screen.getByLabelText(/^\/\/ refresh mode$/i) as HTMLSelectElement;
    const offered = Array.from(select.options).map((o) => o.value);
    expect(offered).toEqual(["", "install", "ttl", "session", "always"]);
  });

  it("static type with invalid loaded refresh.mode: resets on save and shows warning", async () => {
    globalThis.fetch = mockFetch(calls) as unknown as typeof fetch;
    // Hand-edited config that bypassed validation: type=dir + refresh.mode=session.
    const src = {
      id: "notes",
      type: "dir",
      path: "/notes",
      delivery: "auto",
      refresh: { mode: "session" },
    } as unknown as KnowledgeSource;
    wrap(
      <EditKnowledgeSourceModal
        agent="a1"
        existingSource={src}
        knowledgeBlock={{ sources: [src] }}
        onClose={() => {}}
      />,
    );
    // A warning should be visible above the refresh group.
    expect(
      screen.getByText(/only `install` mode is allowed|will be cleared on save/i),
    ).toBeInTheDocument();
    // Without further edits, the editor should be dirty (auto-reset)
    // and Save should be enabled, then write a corrected refresh value.
    const save = screen.getByRole("button", { name: /^save$/i });
    expect(save.hasAttribute("disabled")).toBe(false);
    fireEvent.click(save);
    await waitFor(() => {
      expect(
        calls.find((c) => c.url.includes("/api/agents/") && c.init?.method === "PUT"),
      ).toBeDefined();
    });
    const put = calls.find((c) => c.url.includes("/api/agents/") && c.init?.method === "PUT")!;
    const body = JSON.parse(put.init!.body as string);
    const written = body.knowledge.sources[0];
    // Either refresh is gone entirely or it's been reset to {mode:"install"}.
    if (written.refresh !== undefined) {
      expect(written.refresh).toEqual({ mode: "install" });
    }
    // Specifically NOT the invalid loaded value.
    expect(written.refresh?.mode).not.toBe("session");
  });

  it("does not render an extractor form control", () => {
    globalThis.fetch = mockFetch(calls) as unknown as typeof fetch;
    const src: KnowledgeSource = {
      id: "docs",
      type: "url",
      url: "https://example.com/x.pdf",
      delivery: "auto",
    };
    wrap(
      <EditKnowledgeSourceModal
        agent="a1"
        existingSource={src}
        knowledgeBlock={{ sources: [src] }}
        onClose={() => {}}
      />,
    );
    expect(screen.queryByLabelText(/extractor/i)).not.toBeInTheDocument();
  });

  it("adopts FieldHelp: renders an info-icon trigger next to known fields", () => {
    globalThis.fetch = mockFetch(calls) as unknown as typeof fetch;
    const src: KnowledgeSource = {
      id: "docs",
      type: "url",
      url: "https://example.com/x",
      delivery: "auto",
    };
    wrap(
      <EditKnowledgeSourceModal
        agent="a1"
        existingSource={src}
        knowledgeBlock={{ sources: [src] }}
        onClose={() => {}}
      />,
    );
    // FieldHelp renders the icon as a button with aria-label "help: <label>".
    expect(screen.getByRole("button", { name: /help: delivery/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /help: retrieval mode/i })).toBeInTheDocument();
    // The url field also has its own help.
    expect(screen.getByRole("button", { name: /help: url/i })).toBeInTheDocument();
  });

  // ─── Lazy fetch toggle ─────────────────────────────────────────────

  it("loading a source with lazy:true shows the toggle ON", () => {
    globalThis.fetch = mockFetch(calls) as unknown as typeof fetch;
    const src = {
      id: "docs",
      type: "url",
      url: "https://example.com/x",
      lazy: true,
    } as unknown as KnowledgeSource;
    wrap(
      <EditKnowledgeSourceModal
        agent="a1"
        existingSource={src}
        knowledgeBlock={{ sources: [src] }}
        onClose={() => {}}
      />,
    );
    const toggle = screen.getByRole("switch", { name: /lazy fetch/i });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
  });

  it("loading a non-lazy URL source shows the toggle OFF", () => {
    globalThis.fetch = mockFetch(calls) as unknown as typeof fetch;
    const src: KnowledgeSource = {
      id: "docs",
      type: "url",
      url: "https://example.com/x",
      delivery: "auto",
    };
    wrap(
      <EditKnowledgeSourceModal
        agent="a1"
        existingSource={src}
        knowledgeBlock={{ sources: [src] }}
        onClose={() => {}}
      />,
    );
    const toggle = screen.getByRole("switch", { name: /lazy fetch/i });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
  });

  it("does not render the lazy toggle for non-URL types", () => {
    globalThis.fetch = mockFetch(calls) as unknown as typeof fetch;
    const src: KnowledgeSource = {
      id: "notes",
      type: "file",
      path: "/x",
      delivery: "auto",
    };
    wrap(
      <EditKnowledgeSourceModal
        agent="a1"
        existingSource={src}
        knowledgeBlock={{ sources: [src] }}
        onClose={() => {}}
      />,
    );
    expect(screen.queryByRole("switch", { name: /lazy fetch/i })).not.toBeInTheDocument();
  });

  it("flipping lazy ON disables delivery, materialize, and inline-budget inputs", () => {
    globalThis.fetch = mockFetch(calls) as unknown as typeof fetch;
    const src: KnowledgeSource = {
      id: "docs",
      type: "url",
      url: "https://example.com/x",
      delivery: "auto",
    };
    wrap(
      <EditKnowledgeSourceModal
        agent="a1"
        existingSource={src}
        knowledgeBlock={{ sources: [src] }}
        onClose={() => {}}
      />,
    );
    const toggle = screen.getByRole("switch", { name: /lazy fetch/i });
    fireEvent.click(toggle);
    expect((screen.getByLabelText(/^\/\/ delivery$/i) as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByLabelText(/^\/\/ materialize$/i) as HTMLSelectElement).disabled).toBe(true);
    expect(
      (screen.getByLabelText(/^\/\/ inline budget tokens/i) as HTMLInputElement).disabled,
    ).toBe(true);
  });

  it("flipping lazy ON disables retrieval-mode and refresh-mode inputs", () => {
    globalThis.fetch = mockFetch(calls) as unknown as typeof fetch;
    const src: KnowledgeSource = {
      id: "docs",
      type: "url",
      url: "https://example.com/x",
      delivery: "auto",
    };
    wrap(
      <EditKnowledgeSourceModal
        agent="a1"
        existingSource={src}
        knowledgeBlock={{ sources: [src] }}
        onClose={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("switch", { name: /lazy fetch/i }));
    expect((screen.getByLabelText(/^\/\/ retrieval mode$/i) as HTMLSelectElement).disabled).toBe(
      true,
    );
    expect((screen.getByLabelText(/^\/\/ refresh mode$/i) as HTMLSelectElement).disabled).toBe(
      true,
    );
  });

  it("flipping lazy ON re-enables retrieval-mode and refresh-mode when flipped OFF", () => {
    globalThis.fetch = mockFetch(calls) as unknown as typeof fetch;
    const src: KnowledgeSource = {
      id: "docs",
      type: "url",
      url: "https://example.com/x",
      delivery: "auto",
    };
    wrap(
      <EditKnowledgeSourceModal
        agent="a1"
        existingSource={src}
        knowledgeBlock={{ sources: [src] }}
        onClose={() => {}}
      />,
    );
    const toggle = screen.getByRole("switch", { name: /lazy fetch/i });
    fireEvent.click(toggle);
    fireEvent.click(toggle);
    expect((screen.getByLabelText(/^\/\/ retrieval mode$/i) as HTMLSelectElement).disabled).toBe(
      false,
    );
    expect((screen.getByLabelText(/^\/\/ refresh mode$/i) as HTMLSelectElement).disabled).toBe(
      false,
    );
  });

  it("flipping lazy ON shows the green hint paragraph", () => {
    globalThis.fetch = mockFetch(calls) as unknown as typeof fetch;
    const src: KnowledgeSource = {
      id: "docs",
      type: "url",
      url: "https://example.com/x",
      delivery: "auto",
    };
    wrap(
      <EditKnowledgeSourceModal
        agent="a1"
        existingSource={src}
        knowledgeBlock={{ sources: [src] }}
        onClose={() => {}}
      />,
    );
    expect(screen.queryByText(/agent reads this description at runtime/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch", { name: /lazy fetch/i }));
    expect(screen.getByText(/agent reads this description at runtime/i)).toBeInTheDocument();
  });

  it("flipping lazy ON with short description surfaces a warning", () => {
    globalThis.fetch = mockFetch(calls) as unknown as typeof fetch;
    const src: KnowledgeSource = {
      id: "docs",
      type: "url",
      url: "https://example.com/x",
      description: "tiny",
      delivery: "auto",
    };
    wrap(
      <EditKnowledgeSourceModal
        agent="a1"
        existingSource={src}
        knowledgeBlock={{ sources: [src] }}
        onClose={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("switch", { name: /lazy fetch/i }));
    expect(screen.getByText(/shorter than 30 chars/i)).toBeInTheDocument();
  });

  it("flipping lazy ON then OFF restores the typed-but-now-disabled values on save", async () => {
    globalThis.fetch = mockFetch(calls) as unknown as typeof fetch;
    const src: KnowledgeSource = {
      id: "docs",
      type: "url",
      url: "https://example.com/x",
      delivery: "auto",
    };
    wrap(
      <EditKnowledgeSourceModal
        agent="a1"
        existingSource={src}
        knowledgeBlock={{ sources: [src] }}
        onClose={() => {}}
      />,
    );
    // Before toggling, set a non-default delivery and a non-default materialize.
    fireEvent.change(screen.getByLabelText(/^\/\/ delivery$/i), { target: { value: "file" } });
    fireEvent.change(screen.getByLabelText(/^\/\/ materialize$/i), {
      target: { value: "markdown" },
    });
    // Flip lazy ON, then OFF.
    const toggle = screen.getByRole("switch", { name: /lazy fetch/i });
    fireEvent.click(toggle);
    fireEvent.click(toggle);
    // Save and assert the typed values made it through.
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => {
      expect(
        calls.find((c) => c.url.includes("/api/agents/a1/config") && c.init?.method === "PUT"),
      ).toBeDefined();
    });
    const put = calls.find(
      (c) => c.url.includes("/api/agents/a1/config") && c.init?.method === "PUT",
    )!;
    const body = JSON.parse(put.init!.body as string);
    const written = body.knowledge.sources[0];
    expect(written.delivery).toBe("file");
    expect(written.materialize).toBe("markdown");
    expect(written.lazy).toBeUndefined();
  });

  it("save with lazy:true writes lazy and DROPS delivery/materialize/extractor/inlineBudgetTokens", async () => {
    globalThis.fetch = mockFetch(calls) as unknown as typeof fetch;
    const src: KnowledgeSource = {
      id: "docs",
      type: "url",
      url: "https://example.com/x",
      delivery: "auto",
    };
    wrap(
      <EditKnowledgeSourceModal
        agent="a1"
        existingSource={src}
        knowledgeBlock={{ sources: [src] }}
        onClose={() => {}}
      />,
    );
    // Fill in fields that should be dropped.
    fireEvent.change(screen.getByLabelText(/^\/\/ delivery$/i), { target: { value: "file" } });
    fireEvent.change(screen.getByLabelText(/^\/\/ materialize$/i), {
      target: { value: "markdown" },
    });
    fireEvent.change(screen.getByLabelText(/^\/\/ inline budget tokens/i), {
      target: { value: "8000" },
    });
    fireEvent.click(screen.getByRole("switch", { name: /lazy fetch/i }));
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => {
      expect(
        calls.find((c) => c.url.includes("/api/agents/a1/config") && c.init?.method === "PUT"),
      ).toBeDefined();
    });
    const put = calls.find(
      (c) => c.url.includes("/api/agents/a1/config") && c.init?.method === "PUT",
    )!;
    const body = JSON.parse(put.init!.body as string);
    const written = body.knowledge.sources[0];
    expect(written.lazy).toBe(true);
    expect("delivery" in written).toBe(false);
    expect("materialize" in written).toBe(false);
    expect("extractor" in written).toBe(false);
    expect("inlineBudgetTokens" in written).toBe(false);
  });

  it("save with lazy:true writes NEITHER retrieval NOR refresh even if set before toggling", async () => {
    globalThis.fetch = mockFetch(calls) as unknown as typeof fetch;
    const src: KnowledgeSource = {
      id: "docs",
      type: "url",
      url: "https://example.com/x",
      delivery: "auto",
    };
    wrap(
      <EditKnowledgeSourceModal
        agent="a1"
        existingSource={src}
        knowledgeBlock={{ sources: [src] }}
        onClose={() => {}}
      />,
    );
    // Set a non-default retrieval mode (hybrid) and a refresh mode (ttl + value)
    // BEFORE flipping lazy on. These must be dropped from the saved config.
    fireEvent.change(screen.getByLabelText(/^\/\/ retrieval mode$/i), {
      target: { value: "hybrid" },
    });
    fireEvent.change(screen.getByLabelText(/^\/\/ refresh mode$/i), { target: { value: "ttl" } });
    fireEvent.change(screen.getByLabelText(/^\/\/ refresh ttl/i), { target: { value: "30m" } });
    // Now flip lazy ON and save.
    fireEvent.click(screen.getByRole("switch", { name: /lazy fetch/i }));
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => {
      expect(
        calls.find((c) => c.url.includes("/api/agents/a1/config") && c.init?.method === "PUT"),
      ).toBeDefined();
    });
    const put = calls.find(
      (c) => c.url.includes("/api/agents/a1/config") && c.init?.method === "PUT",
    )!;
    const body = JSON.parse(put.init!.body as string);
    const written = body.knowledge.sources[0];
    expect(written.lazy).toBe(true);
    expect("retrieval" in written).toBe(false);
    expect("refresh" in written).toBe(false);
  });

  it("lazy ON makes a source saveable even with a malformed retrieval.mcpUrl typed before toggling", async () => {
    globalThis.fetch = mockFetch(calls) as unknown as typeof fetch;
    const src: KnowledgeSource = {
      id: "docs",
      type: "url",
      url: "https://example.com/x",
      delivery: "auto",
    };
    wrap(
      <EditKnowledgeSourceModal
        agent="a1"
        existingSource={src}
        knowledgeBlock={{ sources: [src] }}
        onClose={() => {}}
      />,
    );
    // external-mcp + a malformed mcpUrl would normally block save (format error)…
    fireEvent.change(screen.getByLabelText(/^\/\/ retrieval mode$/i), {
      target: { value: "external-mcp" },
    });
    fireEvent.change(screen.getByLabelText(/^\/\/ retrieval\.mcpUrl$/i), {
      target: { value: "not-a-url" },
    });
    // …but flipping lazy ON drops retrieval entirely, so the form must be saveable.
    fireEvent.click(screen.getByRole("switch", { name: /lazy fetch/i }));
    const saveBtn = screen.getByRole("button", { name: /^save$/i });
    expect(saveBtn).not.toBeDisabled();
    fireEvent.click(saveBtn);
    await waitFor(() => {
      expect(
        calls.find((c) => c.url.includes("/api/agents/a1/config") && c.init?.method === "PUT"),
      ).toBeDefined();
    });
    const put = calls.find(
      (c) => c.url.includes("/api/agents/a1/config") && c.init?.method === "PUT",
    )!;
    const written = JSON.parse(put.init!.body as string).knowledge.sources[0];
    expect(written.lazy).toBe(true);
    expect("retrieval" in written).toBe(false);
  });

  it("save with lazy:false omits the lazy key entirely", async () => {
    globalThis.fetch = mockFetch(calls) as unknown as typeof fetch;
    const src: KnowledgeSource = {
      id: "docs",
      type: "url",
      url: "https://example.com/x",
      delivery: "auto",
    };
    wrap(
      <EditKnowledgeSourceModal
        agent="a1"
        existingSource={src}
        knowledgeBlock={{ sources: [src] }}
        onClose={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText(/^\/\/ url$/i), {
      target: { value: "https://example.com/y" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => {
      expect(
        calls.find((c) => c.url.includes("/api/agents/a1/config") && c.init?.method === "PUT"),
      ).toBeDefined();
    });
    const put = calls.find(
      (c) => c.url.includes("/api/agents/a1/config") && c.init?.method === "PUT",
    )!;
    const body = JSON.parse(put.init!.body as string);
    expect("lazy" in body.knowledge.sources[0]).toBe(false);
  });

  it("stale-artifacts confirm appears on non-lazy → lazy save when cache exists", async () => {
    globalThis.fetch = mockFetch(calls, {
      cacheStatus: { hasCachedFiles: true },
    }) as unknown as typeof fetch;
    const src: KnowledgeSource = {
      id: "docs",
      type: "url",
      url: "https://example.com/x",
      delivery: "auto",
    };
    wrap(
      <EditKnowledgeSourceModal
        agent="a1"
        existingSource={src}
        knowledgeBlock={{ sources: [src] }}
        onClose={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("switch", { name: /lazy fetch/i }));
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    // Cache-status check is fired.
    await waitFor(() => {
      expect(calls.find((c) => c.url.includes("/cache-status"))).toBeDefined();
    });
    // Confirm modal appears.
    await screen.findByText(/switch to lazy fetch/i);
  });

  it("stale-artifacts confirm does NOT appear when flipping lazy → non-lazy", async () => {
    globalThis.fetch = mockFetch(calls, {
      cacheStatus: { hasCachedFiles: true },
    }) as unknown as typeof fetch;
    const src = {
      id: "docs",
      type: "url",
      url: "https://example.com/x",
      lazy: true,
    } as unknown as KnowledgeSource;
    wrap(
      <EditKnowledgeSourceModal
        agent="a1"
        existingSource={src}
        knowledgeBlock={{ sources: [src] }}
        onClose={() => {}}
      />,
    );
    // Flip lazy off.
    fireEvent.click(screen.getByRole("switch", { name: /lazy fetch/i }));
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => {
      expect(
        calls.find((c) => c.url.includes("/api/agents/a1/config") && c.init?.method === "PUT"),
      ).toBeDefined();
    });
    expect(screen.queryByText(/switch to lazy fetch/i)).not.toBeInTheDocument();
  });

  it("stale-artifacts confirm does NOT appear when cache is empty", async () => {
    globalThis.fetch = mockFetch(calls, {
      cacheStatus: { hasCachedFiles: false },
    }) as unknown as typeof fetch;
    const src: KnowledgeSource = {
      id: "docs",
      type: "url",
      url: "https://example.com/x",
      delivery: "auto",
    };
    wrap(
      <EditKnowledgeSourceModal
        agent="a1"
        existingSource={src}
        knowledgeBlock={{ sources: [src] }}
        onClose={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("switch", { name: /lazy fetch/i }));
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => {
      expect(
        calls.find((c) => c.url.includes("/api/agents/a1/config") && c.init?.method === "PUT"),
      ).toBeDefined();
    });
    expect(screen.queryByText(/switch to lazy fetch/i)).not.toBeInTheDocument();
  });

  it("stale-artifacts confirm: 'Cancel' keeps modal open and does not save", async () => {
    globalThis.fetch = mockFetch(calls, {
      cacheStatus: { hasCachedFiles: true },
    }) as unknown as typeof fetch;
    const src: KnowledgeSource = {
      id: "docs",
      type: "url",
      url: "https://example.com/x",
      delivery: "auto",
    };
    wrap(
      <EditKnowledgeSourceModal
        agent="a1"
        existingSource={src}
        knowledgeBlock={{ sources: [src] }}
        onClose={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("switch", { name: /lazy fetch/i }));
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await screen.findByText(/switch to lazy fetch/i);
    // Click Cancel inside the confirm.
    const cancelButtons = screen.getAllByRole("button", { name: /^cancel$/i });
    // The confirm modal renders its own Cancel button (the one inside the dialog).
    const confirmCancel = cancelButtons[cancelButtons.length - 1]!;
    fireEvent.click(confirmCancel);
    // Confirm dismissed, no PUT fired.
    expect(screen.queryByText(/switch to lazy fetch/i)).not.toBeInTheDocument();
    expect(
      calls.find((c) => c.url.includes("/api/agents/a1/config") && c.init?.method === "PUT"),
    ).toBeUndefined();
  });

  it("stale-artifacts confirm: 'Save and keep' saves without DELETE", async () => {
    globalThis.fetch = mockFetch(calls, {
      cacheStatus: { hasCachedFiles: true },
    }) as unknown as typeof fetch;
    const src: KnowledgeSource = {
      id: "docs",
      type: "url",
      url: "https://example.com/x",
      delivery: "auto",
    };
    wrap(
      <EditKnowledgeSourceModal
        agent="a1"
        existingSource={src}
        knowledgeBlock={{ sources: [src] }}
        onClose={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("switch", { name: /lazy fetch/i }));
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    const keepButton = await screen.findByRole("button", {
      name: /save and keep cached files/i,
    });
    fireEvent.click(keepButton);
    await waitFor(() => {
      expect(
        calls.find((c) => c.url.includes("/api/agents/a1/config") && c.init?.method === "PUT"),
      ).toBeDefined();
    });
    // No DELETE call.
    expect(
      calls.find((c) => c.url.endsWith("/cache") && c.init?.method === "DELETE"),
    ).toBeUndefined();
  });

  it("stale-artifacts confirm: 'Save and delete' calls DELETE then save", async () => {
    globalThis.fetch = mockFetch(calls, {
      cacheStatus: { hasCachedFiles: true },
    }) as unknown as typeof fetch;
    const src: KnowledgeSource = {
      id: "docs",
      type: "url",
      url: "https://example.com/x",
      delivery: "auto",
    };
    wrap(
      <EditKnowledgeSourceModal
        agent="a1"
        existingSource={src}
        knowledgeBlock={{ sources: [src] }}
        onClose={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("switch", { name: /lazy fetch/i }));
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    const deleteButton = await screen.findByRole("button", {
      name: /save and delete cached files/i,
    });
    fireEvent.click(deleteButton);
    await waitFor(() => {
      expect(
        calls.find((c) => c.url.endsWith("/cache") && c.init?.method === "DELETE"),
      ).toBeDefined();
    });
    await waitFor(() => {
      expect(
        calls.find((c) => c.url.includes("/api/agents/a1/config") && c.init?.method === "PUT"),
      ).toBeDefined();
    });
    // Order: DELETE before PUT.
    const deleteIdx = calls.findIndex(
      (c) => c.url.endsWith("/cache") && c.init?.method === "DELETE",
    );
    const putIdx = calls.findIndex(
      (c) => c.url.includes("/api/agents/a1/config") && c.init?.method === "PUT",
    );
    expect(deleteIdx).toBeLessThan(putIdx);
  });

  it("shows server error inline when PUT fails", async () => {
    globalThis.fetch = mockFetch(calls, { putStatus: 400 }) as unknown as typeof fetch;
    const src: KnowledgeSource = {
      id: "docs",
      type: "url",
      url: "https://example.com/x",
      delivery: "auto",
    };
    wrap(
      <EditKnowledgeSourceModal
        agent="a1"
        existingSource={src}
        knowledgeBlock={{ sources: [src] }}
        onClose={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText(/^\/\/ url$/i), {
      target: { value: "https://example.com/y" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });

  // ─── Save-success notification ─────────────────────────────────────

  describe("save-success notification", () => {
    it("fires a success toast (Saved.) when drift is empty after save", async () => {
      globalThis.fetch = mockFetch(calls, { drift: { drifted: [] } }) as unknown as typeof fetch;
      const src: KnowledgeSource = {
        id: "docs",
        type: "url",
        url: "https://example.com/x",
        delivery: "auto",
      };
      wrap(
        <EditKnowledgeSourceModal
          agent="a1"
          existingSource={src}
          knowledgeBlock={{ sources: [src] }}
          reinstall={noopReinstall}
          onClose={() => {}}
        />,
      );
      fireEvent.change(screen.getByLabelText(/^\/\/ url$/i), {
        target: { value: "https://example.com/y" },
      });
      fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
      // PUT must complete before the toast fires.
      await waitFor(() => {
        expect(
          calls.find((c) => c.url.includes("/api/agents/a1/config") && c.init?.method === "PUT"),
        ).toBeDefined();
      });
      // Success toast appears (the modal has unmounted, but the toast lives
      // in the surrounding NotificationCenter).
      await screen.findByText(/^saved\.$/i);
    });

    it("fires an info toast with body + action when drift is non-empty", async () => {
      globalThis.fetch = mockFetch(calls, {
        drift: { drifted: ["claude-code", "kiro"] },
      }) as unknown as typeof fetch;
      const src: KnowledgeSource = {
        id: "docs",
        type: "url",
        url: "https://example.com/x",
        delivery: "auto",
      };
      wrap(
        <EditKnowledgeSourceModal
          agent="a1"
          existingSource={src}
          knowledgeBlock={{ sources: [src] }}
          reinstall={noopReinstall}
          onClose={() => {}}
        />,
      );
      fireEvent.change(screen.getByLabelText(/^\/\/ url$/i), {
        target: { value: "https://example.com/y" },
      });
      fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
      // The drift list is included verbatim in the toast body.
      await screen.findByText(/re-install required to apply on claude-code, kiro/i);
      // The action button is present.
      expect(screen.getByRole("button", { name: /re-install now/i })).toBeInTheDocument();
    });

    it("clicking 'Re-install now' invokes reinstall with the drifted platforms", async () => {
      globalThis.fetch = mockFetch(calls, {
        drift: { drifted: ["claude-code"] },
      }) as unknown as typeof fetch;
      const reinstall = vi.fn();
      const src: KnowledgeSource = {
        id: "docs",
        type: "url",
        url: "https://example.com/x",
        delivery: "auto",
      };
      wrap(
        <EditKnowledgeSourceModal
          agent="a1"
          existingSource={src}
          knowledgeBlock={{ sources: [src] }}
          reinstall={reinstall}
          onClose={() => {}}
        />,
      );
      fireEvent.change(screen.getByLabelText(/^\/\/ url$/i), {
        target: { value: "https://example.com/y" },
      });
      fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
      const action = await screen.findByRole("button", { name: /re-install now/i });
      fireEvent.click(action);
      expect(reinstall).toHaveBeenCalledTimes(1);
      expect(reinstall).toHaveBeenCalledWith(["claude-code"]);
    });

    it("clicking the action button also dismisses the info toast", async () => {
      globalThis.fetch = mockFetch(calls, {
        drift: { drifted: ["claude-code"] },
      }) as unknown as typeof fetch;
      const src: KnowledgeSource = {
        id: "docs",
        type: "url",
        url: "https://example.com/x",
        delivery: "auto",
      };
      wrap(
        <EditKnowledgeSourceModal
          agent="a1"
          existingSource={src}
          knowledgeBlock={{ sources: [src] }}
          reinstall={() => {
            /* don't open a fresh notification — keep the test focused */
          }}
          onClose={() => {}}
        />,
      );
      fireEvent.change(screen.getByLabelText(/^\/\/ url$/i), {
        target: { value: "https://example.com/y" },
      });
      fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
      const action = await screen.findByRole("button", { name: /re-install now/i });
      fireEvent.click(action);
      // After click, the toast body text should disappear.
      await waitFor(() => {
        expect(screen.queryByText(/re-install required to apply/i)).not.toBeInTheDocument();
      });
    });

    it("two saves against the same agent dedup to a single toast (replace in place)", async () => {
      // Saving twice in succession — modal closes after each save, but the
      // toast lives in the surrounding NotificationCenter. Both notify
      // calls share the same dedupKey (`agent-saved:a1`) so the second
      // toast must replace the first rather than stack.
      globalThis.fetch = mockFetch(calls, { drift: { drifted: [] } }) as unknown as typeof fetch;
      // Use a wrapper that mounts/unmounts the modal between saves to mimic
      // the real UX: open → save → close → reopen → save.
      function Harness({ visible, urlValue }: { visible: boolean; urlValue: string }) {
        const next: KnowledgeSource = {
          id: "docs",
          type: "url",
          url: urlValue,
          delivery: "auto",
        };
        return visible ? (
          <EditKnowledgeSourceModal
            agent="a1"
            existingSource={next}
            knowledgeBlock={{ sources: [next] }}
            reinstall={noopReinstall}
            onClose={() => {}}
          />
        ) : null;
      }
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const { rerender } = render(
        <QueryClientProvider client={qc}>
          <NotificationCenter>
            <Harness visible urlValue="https://example.com/x" />
          </NotificationCenter>
        </QueryClientProvider>,
      );
      // First save.
      fireEvent.change(screen.getByLabelText(/^\/\/ url$/i), {
        target: { value: "https://example.com/y1" },
      });
      fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
      await screen.findByText(/^saved\.$/i);
      // Close the modal, then re-open and save again. The
      // NotificationCenter is preserved across the re-render.
      rerender(
        <QueryClientProvider client={qc}>
          <NotificationCenter>
            <Harness visible={false} urlValue="https://example.com/x" />
          </NotificationCenter>
        </QueryClientProvider>,
      );
      rerender(
        <QueryClientProvider client={qc}>
          <NotificationCenter>
            <Harness visible urlValue="https://example.com/x" />
          </NotificationCenter>
        </QueryClientProvider>,
      );
      fireEvent.change(screen.getByLabelText(/^\/\/ url$/i), {
        target: { value: "https://example.com/y2" },
      });
      fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
      // The dedupKey replacement keeps the visible toast count at 1.
      await waitFor(() => {
        expect(screen.queryAllByText(/^saved\.$/i).length).toBe(1);
      });
    });

    it("Save and keep (lazy confirm) also fires the post-save toast", async () => {
      globalThis.fetch = mockFetch(calls, {
        cacheStatus: { hasCachedFiles: true },
        drift: { drifted: [] },
      }) as unknown as typeof fetch;
      const src: KnowledgeSource = {
        id: "docs",
        type: "url",
        url: "https://example.com/x",
        delivery: "auto",
      };
      wrap(
        <EditKnowledgeSourceModal
          agent="a1"
          existingSource={src}
          knowledgeBlock={{ sources: [src] }}
          reinstall={noopReinstall}
          onClose={() => {}}
        />,
      );
      fireEvent.click(screen.getByRole("switch", { name: /lazy fetch/i }));
      fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
      const keepBtn = await screen.findByRole("button", {
        name: /save and keep cached files/i,
      });
      fireEvent.click(keepBtn);
      await screen.findByText(/^saved\.$/i);
    });

    it("Save and delete (lazy confirm) also fires the post-save toast", async () => {
      globalThis.fetch = mockFetch(calls, {
        cacheStatus: { hasCachedFiles: true },
        drift: { drifted: [] },
      }) as unknown as typeof fetch;
      const src: KnowledgeSource = {
        id: "docs",
        type: "url",
        url: "https://example.com/x",
        delivery: "auto",
      };
      wrap(
        <EditKnowledgeSourceModal
          agent="a1"
          existingSource={src}
          knowledgeBlock={{ sources: [src] }}
          reinstall={noopReinstall}
          onClose={() => {}}
        />,
      );
      fireEvent.click(screen.getByRole("switch", { name: /lazy fetch/i }));
      fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
      const deleteBtn = await screen.findByRole("button", {
        name: /save and delete cached files/i,
      });
      fireEvent.click(deleteBtn);
      await screen.findByText(/^saved\.$/i);
    });
  });

  // ─── Hybrid-retrieval restart notice ───────────────────────────────

  describe("hybrid retrieval restart notice", () => {
    it("fires a sticky restart toast when retrieval is changed bm25 → hybrid", async () => {
      globalThis.fetch = mockFetch(calls, { drift: { drifted: [] } }) as unknown as typeof fetch;
      const src: KnowledgeSource = {
        id: "docs",
        type: "url",
        url: "https://example.com/x",
        delivery: "auto",
      };
      wrap(
        <EditKnowledgeSourceModal
          agent="a1"
          existingSource={src}
          knowledgeBlock={{ sources: [src] }}
          reinstall={noopReinstall}
          onClose={() => {}}
        />,
      );
      fireEvent.change(screen.getByLabelText(/^\/\/ retrieval mode$/i), {
        target: { value: "hybrid" },
      });
      fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
      await waitFor(() => {
        expect(
          calls.find((c) => c.url.includes("/api/agents/a1/config") && c.init?.method === "PUT"),
        ).toBeDefined();
      });
      // Sticky restart toast appears mentioning restart + the MCP server + hybrid.
      await screen.findByText(/restart needed for hybrid search/i);
      expect(screen.getByText(/knowledge mcp server restarts/i)).toBeInTheDocument();
      expect(screen.getByText(/a1-knowledge/i)).toBeInTheDocument();
    });

    it("fires the restart toast when retrieval is changed hybrid → bm25 (disable also needs restart)", async () => {
      globalThis.fetch = mockFetch(calls, { drift: { drifted: [] } }) as unknown as typeof fetch;
      const src = {
        id: "docs",
        type: "url",
        url: "https://example.com/x",
        delivery: "auto",
        retrieval: { mode: "hybrid" },
      } as unknown as KnowledgeSource;
      wrap(
        <EditKnowledgeSourceModal
          agent="a1"
          existingSource={src}
          knowledgeBlock={{ sources: [src] }}
          reinstall={noopReinstall}
          onClose={() => {}}
        />,
      );
      fireEvent.change(screen.getByLabelText(/^\/\/ retrieval mode$/i), {
        target: { value: "bm25" },
      });
      fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
      await waitFor(() => {
        expect(
          calls.find((c) => c.url.includes("/api/agents/a1/config") && c.init?.method === "PUT"),
        ).toBeDefined();
      });
      await screen.findByText(/restart needed for hybrid search/i);
    });

    it("does NOT fire the restart toast for a non-hybrid change (just the url)", async () => {
      globalThis.fetch = mockFetch(calls, { drift: { drifted: [] } }) as unknown as typeof fetch;
      const src: KnowledgeSource = {
        id: "docs",
        type: "url",
        url: "https://example.com/x",
        delivery: "auto",
      };
      wrap(
        <EditKnowledgeSourceModal
          agent="a1"
          existingSource={src}
          knowledgeBlock={{ sources: [src] }}
          reinstall={noopReinstall}
          onClose={() => {}}
        />,
      );
      fireEvent.change(screen.getByLabelText(/^\/\/ url$/i), {
        target: { value: "https://example.com/y" },
      });
      fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
      // The normal saved toast still fires; the restart toast must not.
      await screen.findByText(/^saved\.$/i);
      expect(screen.queryByText(/restart needed for hybrid search/i)).not.toBeInTheDocument();
    });

    it("does NOT fire the restart toast when the source is made lazy (retrieval dropped)", async () => {
      globalThis.fetch = mockFetch(calls, {
        cacheStatus: { hasCachedFiles: false },
        drift: { drifted: [] },
      }) as unknown as typeof fetch;
      const src = {
        id: "docs",
        type: "url",
        url: "https://example.com/x",
        delivery: "auto",
        retrieval: { mode: "hybrid" },
      } as unknown as KnowledgeSource;
      wrap(
        <EditKnowledgeSourceModal
          agent="a1"
          existingSource={src}
          knowledgeBlock={{ sources: [src] }}
          reinstall={noopReinstall}
          onClose={() => {}}
        />,
      );
      // Flip retrieval to bm25 AND turn on lazy — retrieval is inert when lazy.
      fireEvent.change(screen.getByLabelText(/^\/\/ retrieval mode$/i), {
        target: { value: "bm25" },
      });
      fireEvent.click(screen.getByRole("switch", { name: /lazy fetch/i }));
      fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
      await screen.findByText(/^saved\.$/i);
      expect(screen.queryByText(/restart needed for hybrid search/i)).not.toBeInTheDocument();
    });
  });

  // ─── Web source type ───────────────────────────────────────────────

  describe("web source type", () => {
    it("renders url, mode, maxPages, depth for a crawl web source", () => {
      globalThis.fetch = mockFetch(calls) as unknown as typeof fetch;
      const src = {
        id: "hn",
        type: "web",
        url: "https://news.ycombinator.com/",
        mode: "crawl",
        maxPages: 30,
        delivery: "file",
      } as unknown as KnowledgeSource;
      wrap(
        <EditKnowledgeSourceModal
          agent="a1"
          existingSource={src}
          knowledgeBlock={{ sources: [src] }}
          onClose={() => {}}
        />,
      );
      expect(screen.getByDisplayValue("https://news.ycombinator.com/")).toBeInTheDocument();
      expect(screen.getByLabelText(/^\/\/ mode$/i)).toHaveValue("crawl");
      expect(screen.getByLabelText(/^\/\/ max pages$/i)).toHaveValue(30);
      expect(screen.getByLabelText(/^\/\/ depth$/i)).toBeInTheDocument();
    });

    it("round-trips web source fields on save", async () => {
      globalThis.fetch = mockFetch(calls) as unknown as typeof fetch;
      const src = {
        id: "hn",
        type: "web",
        url: "https://news.ycombinator.com/",
        mode: "crawl",
        maxPages: 30,
        depth: 3,
        sameOrigin: false,
        delivery: "file",
      } as unknown as KnowledgeSource;
      wrap(
        <EditKnowledgeSourceModal
          agent="a1"
          existingSource={src}
          knowledgeBlock={{ sources: [src] }}
          onClose={() => {}}
        />,
      );
      // Change the url to make it dirty
      fireEvent.change(screen.getByDisplayValue("https://news.ycombinator.com/"), {
        target: { value: "https://news.ycombinator.com/newest" },
      });
      fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
      await waitFor(() => {
        expect(
          calls.find((c) => c.url.includes("/api/agents/") && c.init?.method === "PUT"),
        ).toBeDefined();
      });
      const put = calls.find((c) => c.url.includes("/api/agents/") && c.init?.method === "PUT")!;
      const body = JSON.parse(put.init!.body as string);
      const saved = body.knowledge.sources[0];
      expect(saved.type).toBe("web");
      expect(saved.url).toBe("https://news.ycombinator.com/newest");
      expect(saved.mode).toBe("crawl");
      expect(saved.maxPages).toBe(30);
      expect(saved.depth).toBe(3);
      expect(saved.sameOrigin).toBe(false);
    });

    it("hides crawl-only fields when mode is llms-txt", () => {
      globalThis.fetch = mockFetch(calls) as unknown as typeof fetch;
      const src = {
        id: "docs",
        type: "web",
        url: "https://example.com/llms.txt",
        mode: "llms-txt",
        delivery: "file",
      } as unknown as KnowledgeSource;
      wrap(
        <EditKnowledgeSourceModal
          agent="a1"
          existingSource={src}
          knowledgeBlock={{ sources: [src] }}
          onClose={() => {}}
        />,
      );
      expect(screen.getByLabelText(/^\/\/ mode$/i)).toHaveValue("llms-txt");
      expect(screen.queryByLabelText(/^\/\/ max pages$/i)).not.toBeInTheDocument();
      expect(screen.queryByLabelText(/^\/\/ depth$/i)).not.toBeInTheDocument();
    });

    it("validates web maxPages 1-200", () => {
      globalThis.fetch = mockFetch(calls) as unknown as typeof fetch;
      const src = {
        id: "hn",
        type: "web",
        url: "https://news.ycombinator.com/",
        mode: "crawl",
        delivery: "file",
      } as unknown as KnowledgeSource;
      wrap(
        <EditKnowledgeSourceModal
          agent="a1"
          existingSource={src}
          knowledgeBlock={{ sources: [src] }}
          onClose={() => {}}
        />,
      );
      fireEvent.change(screen.getByLabelText(/^\/\/ max pages$/i), {
        target: { value: "150" },
      });
      // 150 is valid for web (cap 200), so no error
      const save = screen.getByRole("button", { name: /^save$/i });
      expect(save.hasAttribute("disabled")).toBe(false);
    });
  });

  // ─── MCP source type ───────────────────────────────────────────────

  describe("mcp source type", () => {
    it("renders server and tool fields for an mcp source", () => {
      globalThis.fetch = mockFetch(calls) as unknown as typeof fetch;
      const src = {
        id: "kb",
        type: "mcp",
        server: "notion",
        tool: "search",
        args: { query: "x" },
        delivery: "file",
      } as unknown as KnowledgeSource;
      wrap(
        <EditKnowledgeSourceModal
          agent="a1"
          existingSource={src}
          knowledgeBlock={{ sources: [src] }}
          onClose={() => {}}
        />,
      );
      expect(screen.getByLabelText(/^\/\/ server$/i)).toHaveValue("notion");
      expect(screen.getByLabelText(/^\/\/ tool$/i)).toHaveValue("search");
      expect(screen.getByLabelText(/^\/\/ args \(one key=value per line\)$/i)).toHaveValue(
        "query=x",
      );
    });

    it("round-trips mcp source fields on save", async () => {
      globalThis.fetch = mockFetch(calls) as unknown as typeof fetch;
      const src = {
        id: "kb",
        type: "mcp",
        server: "notion",
        tool: "search",
        args: { query: "x" },
        delivery: "file",
      } as unknown as KnowledgeSource;
      wrap(
        <EditKnowledgeSourceModal
          agent="a1"
          existingSource={src}
          knowledgeBlock={{ sources: [src] }}
          onClose={() => {}}
        />,
      );
      fireEvent.change(screen.getByLabelText(/^\/\/ tool$/i), {
        target: { value: "search_pages" },
      });
      fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
      await waitFor(() => {
        expect(
          calls.find((c) => c.url.includes("/api/agents/") && c.init?.method === "PUT"),
        ).toBeDefined();
      });
      const put = calls.find((c) => c.url.includes("/api/agents/") && c.init?.method === "PUT")!;
      const body = JSON.parse(put.init!.body as string);
      const saved = body.knowledge.sources[0];
      expect(saved.type).toBe("mcp");
      expect(saved.server).toBe("notion");
      expect(saved.tool).toBe("search_pages");
      expect(saved.args).toEqual({ query: "x" });
    });

    it("validates mcp requires server and tool", () => {
      globalThis.fetch = mockFetch(calls) as unknown as typeof fetch;
      const src = {
        id: "kb",
        type: "mcp",
        server: "notion",
        tool: "search",
        delivery: "file",
      } as unknown as KnowledgeSource;
      wrap(
        <EditKnowledgeSourceModal
          agent="a1"
          existingSource={src}
          knowledgeBlock={{ sources: [src] }}
          onClose={() => {}}
        />,
      );
      fireEvent.change(screen.getByLabelText(/^\/\/ server$/i), {
        target: { value: "" },
      });
      const save = screen.getByRole("button", { name: /^save$/i });
      expect(save.hasAttribute("disabled")).toBe(true);
    });

    it("rejects credential-shaped args keys and shows error text", () => {
      globalThis.fetch = mockFetch(calls) as unknown as typeof fetch;
      const src = {
        id: "kb",
        type: "mcp",
        server: "notion",
        tool: "search",
        delivery: "file",
      } as unknown as KnowledgeSource;
      wrap(
        <EditKnowledgeSourceModal
          agent="a1"
          existingSource={src}
          knowledgeBlock={{ sources: [src] }}
          onClose={() => {}}
        />,
      );
      fireEvent.change(screen.getByLabelText(/^\/\/ args \(one key=value per line\)$/i), {
        target: { value: "api_key=secret123" },
      });
      const save = screen.getByRole("button", { name: /^save$/i });
      expect(save.hasAttribute("disabled")).toBe(true);
      // Error text is visible below the textarea
      expect(screen.getByText(/looks like a credential/i)).toBeInTheDocument();
    });

    it("round-trips preset and allowWriteTool on save", async () => {
      globalThis.fetch = mockFetch(calls) as unknown as typeof fetch;
      const src = {
        id: "kb",
        type: "mcp",
        server: "notion",
        tool: "search",
        preset: "team-shared",
        allowWriteTool: true,
        delivery: "file",
      } as unknown as KnowledgeSource;
      wrap(
        <EditKnowledgeSourceModal
          agent="a1"
          existingSource={src}
          knowledgeBlock={{ sources: [src] }}
          onClose={() => {}}
        />,
      );
      // Make it dirty by changing description
      fireEvent.change(screen.getByLabelText(/^\/\/ description$/i), {
        target: { value: "updated" },
      });
      fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
      await waitFor(() => {
        expect(
          calls.find((c) => c.url.includes("/api/agents/") && c.init?.method === "PUT"),
        ).toBeDefined();
      });
      const put = calls.find((c) => c.url.includes("/api/agents/") && c.init?.method === "PUT")!;
      const body = JSON.parse(put.init!.body as string);
      const saved = body.knowledge.sources[0];
      expect(saved.preset).toBe("team-shared");
      expect(saved.allowWriteTool).toBe(true);
    });
  });

  describe("web crawl include/exclude round-trip", () => {
    it("round-trips include and exclude arrays on save", async () => {
      globalThis.fetch = mockFetch(calls) as unknown as typeof fetch;
      const src = {
        id: "site",
        type: "web",
        url: "https://example.com/",
        mode: "crawl",
        include: ["/docs/**"],
        exclude: ["/blog/**"],
        delivery: "file",
      } as unknown as KnowledgeSource;
      wrap(
        <EditKnowledgeSourceModal
          agent="a1"
          existingSource={src}
          knowledgeBlock={{ sources: [src] }}
          onClose={() => {}}
        />,
      );
      // Make dirty by changing description
      fireEvent.change(screen.getByLabelText(/^\/\/ description$/i), {
        target: { value: "crawl docs" },
      });
      fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
      await waitFor(() => {
        expect(
          calls.find((c) => c.url.includes("/api/agents/") && c.init?.method === "PUT"),
        ).toBeDefined();
      });
      const put = calls.find((c) => c.url.includes("/api/agents/") && c.init?.method === "PUT")!;
      const body = JSON.parse(put.init!.body as string);
      const saved = body.knowledge.sources[0];
      expect(saved.include).toEqual(["/docs/**"]);
      expect(saved.exclude).toEqual(["/blog/**"]);
    });
  });

  // ─── Webpage source type (post-rename from "url") ─────────────────

  describe("webpage source type", () => {
    it("renders url field for a webpage source (same as old url type)", () => {
      globalThis.fetch = mockFetch(calls) as unknown as typeof fetch;
      const src = {
        id: "docs",
        type: "webpage",
        url: "https://example.com/page",
        delivery: "auto",
      } as unknown as KnowledgeSource;
      wrap(
        <EditKnowledgeSourceModal
          agent="a1"
          existingSource={src}
          knowledgeBlock={{ sources: [src] }}
          onClose={() => {}}
        />,
      );
      expect(screen.getByLabelText(/^\/\/ url$/i)).toHaveValue("https://example.com/page");
    });

    it("round-trips webpage source on save", async () => {
      globalThis.fetch = mockFetch(calls) as unknown as typeof fetch;
      const src = {
        id: "docs",
        type: "webpage",
        url: "https://example.com/page",
        delivery: "auto",
      } as unknown as KnowledgeSource;
      wrap(
        <EditKnowledgeSourceModal
          agent="a1"
          existingSource={src}
          knowledgeBlock={{ sources: [src] }}
          onClose={() => {}}
        />,
      );
      fireEvent.change(screen.getByLabelText(/^\/\/ url$/i), {
        target: { value: "https://example.com/other" },
      });
      fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
      await waitFor(() => {
        expect(
          calls.find((c) => c.url.includes("/api/agents/") && c.init?.method === "PUT"),
        ).toBeDefined();
      });
      const put = calls.find((c) => c.url.includes("/api/agents/") && c.init?.method === "PUT")!;
      const body = JSON.parse(put.init!.body as string);
      const saved = body.knowledge.sources[0];
      expect(saved.type).toBe("webpage");
      expect(saved.url).toBe("https://example.com/other");
    });

    it("webpage source shows auth select and lazy toggle", () => {
      globalThis.fetch = mockFetch(calls) as unknown as typeof fetch;
      const src = {
        id: "docs",
        type: "webpage",
        url: "https://example.com/page",
        delivery: "auto",
      } as unknown as KnowledgeSource;
      wrap(
        <EditKnowledgeSourceModal
          agent="a1"
          existingSource={src}
          knowledgeBlock={{ sources: [src] }}
          onClose={() => {}}
        />,
      );
      expect(screen.getByLabelText(/^\/\/ auth$/i)).toBeInTheDocument();
      expect(screen.getByRole("switch", { name: /lazy fetch/i })).toBeInTheDocument();
    });
  });
});

describe("EditKnowledgeSourceModal — exhaustive type coverage (regression guard)", () => {
  // Every acquirable KnowledgeSource type (excluding deprecated 'url' alias)
  // must render a type-specific field. When adding a new source type, add a
  // fixture + probe here — the self-check at the end will fail until you do.
  const ACQUIRABLE_TYPES = [
    "file",
    "dir",
    "glob",
    "webpage",
    "web",
    "git",
    "npm",
    "confluence",
    "jira",
    "mcp",
  ] as const;

  type AcquirableType = (typeof ACQUIRABLE_TYPES)[number];

  const FIXTURES: Record<AcquirableType, KnowledgeSource> = {
    file: { id: "f", type: "file", path: "/x.md", delivery: "auto" } as KnowledgeSource,
    dir: { id: "d", type: "dir", path: "/notes", delivery: "auto" } as KnowledgeSource,
    glob: { id: "g", type: "glob", path: "**/*.md", delivery: "auto" } as KnowledgeSource,
    webpage: {
      id: "w",
      type: "webpage",
      url: "https://x.com/p",
      delivery: "auto",
    } as KnowledgeSource,
    web: {
      id: "wc",
      type: "web",
      url: "https://x.com/",
      mode: "crawl",
      delivery: "file",
    } as unknown as KnowledgeSource,
    git: {
      id: "gi",
      type: "git",
      url: "https://github.com/x/y",
      delivery: "auto",
    } as KnowledgeSource,
    npm: { id: "n", type: "npm", package: "@scope/pkg", delivery: "auto" } as KnowledgeSource,
    confluence: { id: "c", type: "confluence", space: "TEAM", delivery: "auto" } as KnowledgeSource,
    jira: { id: "j", type: "jira", jql: "project=X", delivery: "auto" } as KnowledgeSource,
    mcp: {
      id: "m",
      type: "mcp",
      server: "notion",
      tool: "search",
      delivery: "file",
    } as unknown as KnowledgeSource,
  };

  // A probe is a regex applied via getByLabelText that uniquely identifies
  // the type-specific rendering branch. Labels follow the `// <label>` pattern.
  const PROBES: Record<AcquirableType, RegExp> = {
    file: /^\/\/ path$/i,
    dir: /^\/\/ directory$/i,
    glob: /^\/\/ glob$/i,
    webpage: /^\/\/ url$/i,
    web: /^\/\/ mode$/i,
    git: /^\/\/ git url$/i,
    npm: /^\/\/ package$/i,
    confluence: /^\/\/ space key$/i,
    jira: /^\/\/ jql$/i,
    mcp: /^\/\/ server$/i,
  };

  // Self-check: every acquirable type has a fixture AND a probe.
  it("self-check: every acquirable type has a fixture and probe", () => {
    for (const t of ACQUIRABLE_TYPES) {
      expect(FIXTURES[t]).toBeDefined();
      expect(PROBES[t]).toBeDefined();
    }
  });

  for (const t of ACQUIRABLE_TYPES) {
    it(`renders a type-specific input for type="${t}"`, () => {
      globalThis.fetch = (async () =>
        new Response(JSON.stringify({ servers: [], toolsByServer: {} }), {
          status: 200,
        })) as unknown as typeof fetch;
      const src = FIXTURES[t];
      wrap(
        <EditKnowledgeSourceModal
          agent="a1"
          existingSource={src}
          knowledgeBlock={{ sources: [src] }}
          onClose={() => {}}
        />,
      );
      expect(screen.getByLabelText(PROBES[t])).toBeInTheDocument();
    });
  }
});
