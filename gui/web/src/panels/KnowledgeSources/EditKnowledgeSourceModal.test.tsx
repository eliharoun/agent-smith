import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { KnowledgeSource, McpServerAndToolsView } from "gui-shared";
import { beforeEach, describe, expect, it } from "vitest";
import { EditKnowledgeSourceModal } from "./EditKnowledgeSourceModal";

type Call = { url: string; init?: RequestInit | undefined };

function mockFetch(
  calls: Call[],
  opts: { putStatus?: number; picker?: McpServerAndToolsView } = {},
) {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({ url, init });
    if (url.endsWith("/mcp-servers-and-tools")) {
      const empty: McpServerAndToolsView = { servers: [], toolsByServer: {} };
      return new Response(JSON.stringify(opts.picker ?? empty), { status: 200 });
    }
    if (url.includes("/api/agents/") && init?.method === "PUT") {
      return new Response(JSON.stringify({ ok: true }), { status: opts.putStatus ?? 200 });
    }
    return new Response("not found", { status: 404 });
  };
}

function wrap(node: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
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
      retrieval: { mode: "bm25" },
    });
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
});
