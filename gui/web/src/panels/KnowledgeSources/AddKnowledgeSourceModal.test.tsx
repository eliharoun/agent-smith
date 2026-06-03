import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { McpServerAndToolsView } from "gui-shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AddKnowledgeSourceModal } from "./AddKnowledgeSourceModal";

type Call = { url: string; init?: RequestInit | undefined };

interface FixtureOpts {
  picker: McpServerAndToolsView;
  agentConfig?: Record<string, unknown>;
}

function mockFetch(calls: Call[], opts: FixtureOpts) {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({ url, init });
    if (url.endsWith("/mcp-servers-and-tools")) {
      return new Response(JSON.stringify(opts.picker), { status: 200 });
    }
    if (url.match(/\/api\/agents\/[^/]+$/) && (!init?.method || init.method === "GET")) {
      return new Response(
        JSON.stringify({
          name: "a1",
          description: "test",
          catalog: "x",
          path: "/p",
          targets: [],
          identity: "",
          expertise: "",
          soul: "",
          user: "",
          config: opts.agentConfig ?? {},
        }),
        { status: 200 },
      );
    }
    if (url.match(/\/api\/agents\/[^/]+\/config$/) && init?.method === "PUT") {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    if (url.endsWith("/api/jobs")) {
      return new Response(JSON.stringify({ id: "job-1" }), { status: 200 });
    }
    return new Response("not found", { status: 404 });
  };
}

function wrap(node: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

async function chooseUrlType() {
  await waitFor(() => expect(screen.getByText(/choose a source type/i)).toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: /^url\b/i }));
}

describe("AddKnowledgeSourceModal — routing dropdown", () => {
  let calls: Call[];
  beforeEach(() => {
    calls = [];
  });

  it("populates the routing dropdown with bundle + AI client servers", async () => {
    globalThis.fetch = mockFetch(calls, {
      picker: {
        servers: [
          { name: "alpha-mcp", source: "bundle" },
          { name: "beta-mcp", source: "available" },
        ],
        toolsByServer: {
          "alpha-mcp": [{ name: "fetch", urlParam: { kind: "string", key: "url" } }],
          "beta-mcp": [{ name: "scrape", urlParam: { kind: "string", key: "url" } }],
        },
      },
    }) as unknown as typeof fetch;
    wrap(<AddKnowledgeSourceModal agent="a1" existingIds={[]} onClose={() => {}} />);
    await chooseUrlType();
    fireEvent.change(screen.getByLabelText(/^\/\/ id$/i), { target: { value: "src-1" } });
    fireEvent.change(screen.getByLabelText(/^\/\/ url$/i), {
      target: { value: "https://example.com/p" },
    });
    const select = await screen.findByRole("combobox", { name: /route through MCP server/i });
    await waitFor(() => {
      expect(select).not.toBeDisabled();
    });
    const optionTexts = Array.from(select.querySelectorAll("option")).map(
      (o) => o.textContent ?? "",
    );
    expect(optionTexts.some((t) => t.includes("alpha-mcp") && t.includes("from bundle"))).toBe(
      true,
    );
    expect(optionTexts.some((t) => t.includes("beta-mcp") && t.includes("from AI client"))).toBe(
      true,
    );
  });

  it("auto-selects the lone URL-shaped tool and shows the route hint", async () => {
    globalThis.fetch = mockFetch(calls, {
      picker: {
        servers: [{ name: "alpha-mcp", source: "bundle" }],
        toolsByServer: {
          "alpha-mcp": [{ name: "fetch_url", urlParam: { kind: "string", key: "url" } }],
        },
      },
    }) as unknown as typeof fetch;
    wrap(<AddKnowledgeSourceModal agent="a1" existingIds={[]} onClose={() => {}} />);
    await chooseUrlType();
    fireEvent.change(screen.getByLabelText(/^\/\/ id$/i), { target: { value: "src-1" } });
    fireEvent.change(screen.getByLabelText(/^\/\/ url$/i), {
      target: { value: "https://example.com/p" },
    });
    const select = await screen.findByRole("combobox", { name: /route through MCP server/i });
    await waitFor(() => expect(select).not.toBeDisabled());
    fireEvent.change(select, { target: { value: "alpha-mcp" } });
    expect(await screen.findByText(/routing through alpha-mcp\.fetch_url/)).toBeInTheDocument();
    // Tool sub-picker is NOT rendered when there is exactly one tool.
    expect(screen.queryByRole("combobox", { name: /route through tool/i })).toBeNull();
  });

  it("renders a tool sub-picker when 2+ URL-shaped tools exist", async () => {
    globalThis.fetch = mockFetch(calls, {
      picker: {
        servers: [{ name: "multi-mcp", source: "available" }],
        toolsByServer: {
          "multi-mcp": [
            { name: "fetch", urlParam: { kind: "string", key: "url" } },
            { name: "scrape", urlParam: { kind: "string-array", key: "urls" } },
          ],
        },
      },
    }) as unknown as typeof fetch;
    wrap(<AddKnowledgeSourceModal agent="a1" existingIds={[]} onClose={() => {}} />);
    await chooseUrlType();
    fireEvent.change(screen.getByLabelText(/^\/\/ id$/i), { target: { value: "src-1" } });
    fireEvent.change(screen.getByLabelText(/^\/\/ url$/i), {
      target: { value: "https://example.com/p" },
    });
    const serverSelect = await screen.findByRole("combobox", {
      name: /route through MCP server/i,
    });
    await waitFor(() => expect(serverSelect).not.toBeDisabled());
    fireEvent.change(serverSelect, { target: { value: "multi-mcp" } });
    const toolSelect = await screen.findByRole("combobox", { name: /route through tool/i });
    expect(toolSelect).toBeInTheDocument();
    const toolNames = Array.from(toolSelect.querySelectorAll("option")).map(
      (o) => (o as HTMLOptionElement).value,
    );
    expect(toolNames).toContain("fetch");
    expect(toolNames).toContain("scrape");
  });

  it("flags servers whose probe failed and disables them", async () => {
    globalThis.fetch = mockFetch(calls, {
      picker: {
        servers: [
          { name: "good", source: "available" },
          { name: "broken", source: "available", error: "spawn ENOENT" },
        ],
        toolsByServer: {
          good: [{ name: "fetch", urlParam: { kind: "string", key: "url" } }],
        },
      },
    }) as unknown as typeof fetch;
    wrap(<AddKnowledgeSourceModal agent="a1" existingIds={[]} onClose={() => {}} />);
    await chooseUrlType();
    fireEvent.change(screen.getByLabelText(/^\/\/ id$/i), { target: { value: "src-1" } });
    fireEvent.change(screen.getByLabelText(/^\/\/ url$/i), {
      target: { value: "https://example.com/p" },
    });
    const select = await screen.findByRole("combobox", { name: /route through MCP server/i });
    await waitFor(() => expect(select).not.toBeDisabled());
    const brokenOption = Array.from(select.querySelectorAll("option")).find((o) =>
      (o.textContent ?? "").includes("broken"),
    ) as HTMLOptionElement | undefined;
    expect(brokenOption).toBeDefined();
    expect(brokenOption?.disabled).toBe(true);
    expect(brokenOption?.textContent).toMatch(/unavailable/);
  });

  it("PUTs the via:-tagged source via /config when a route is picked", async () => {
    globalThis.fetch = mockFetch(calls, {
      picker: {
        servers: [{ name: "alpha-mcp", source: "available" }],
        toolsByServer: {
          "alpha-mcp": [{ name: "fetch", urlParam: { kind: "string", key: "url" } }],
        },
      },
      // bundle has no mcpServers[] yet — pick should append.
      agentConfig: { knowledge: { sources: [] } },
    }) as unknown as typeof fetch;
    wrap(<AddKnowledgeSourceModal agent="a1" existingIds={[]} onClose={() => {}} />);
    await chooseUrlType();
    fireEvent.change(screen.getByLabelText(/^\/\/ id$/i), { target: { value: "src-1" } });
    fireEvent.change(screen.getByLabelText(/^\/\/ url$/i), {
      target: { value: "https://example.com/p" },
    });
    const select = await screen.findByRole("combobox", { name: /route through MCP server/i });
    await waitFor(() => expect(select).not.toBeDisabled());
    fireEvent.change(select, { target: { value: "alpha-mcp" } });
    await screen.findByText(/routing through alpha-mcp\.fetch/);
    fireEvent.submit(document.getElementById("knowledge-add-form") as HTMLFormElement);
    await waitFor(() => {
      const put = calls.find(
        (c) => c.url.endsWith("/api/agents/a1/config") && c.init?.method === "PUT",
      );
      expect(put).toBeDefined();
    });
    const put = calls.find(
      (c) => c.url.endsWith("/api/agents/a1/config") && c.init?.method === "PUT",
    );
    const body = JSON.parse(put?.init?.body as string) as {
      knowledge: { sources: Array<Record<string, unknown>> };
      mcpServers?: string[];
    };
    expect(body.knowledge.sources[0]).toMatchObject({
      id: "src-1",
      type: "url",
      url: "https://example.com/p",
      via: { server: "alpha-mcp", tool: "fetch" },
    });
    // alpha-mcp came from the AI client ("available"), so the modal extends
    // mcpServers[] on save — the bundle didn't declare it before.
    expect(body.mcpServers).toEqual(["alpha-mcp"]);
    // No knowledge.add job was dispatched in this branch (the via: path
    // bypasses the CLI to write the via: block directly).
    const jobCall = calls.find((c) => c.url.endsWith("/api/jobs"));
    expect(jobCall).toBeUndefined();
  });

  it("falls back to the knowledge.add job when the user picks Direct HTTP", async () => {
    globalThis.fetch = mockFetch(calls, {
      picker: {
        servers: [{ name: "alpha-mcp", source: "available" }],
        toolsByServer: {
          "alpha-mcp": [{ name: "fetch", urlParam: { kind: "string", key: "url" } }],
        },
      },
    }) as unknown as typeof fetch;
    const onClose = vi.fn();
    wrap(<AddKnowledgeSourceModal agent="a1" existingIds={[]} onClose={onClose} />);
    await chooseUrlType();
    fireEvent.change(screen.getByLabelText(/^\/\/ id$/i), { target: { value: "src-1" } });
    fireEvent.change(screen.getByLabelText(/^\/\/ url$/i), {
      target: { value: "https://example.com/p" },
    });
    // Leave the routing dropdown at its default ("(none — direct HTTP)").
    fireEvent.submit(document.getElementById("knowledge-add-form") as HTMLFormElement);
    await waitFor(() => {
      expect(calls.some((c) => c.url.endsWith("/api/jobs"))).toBe(true);
    });
    const job = calls.find((c) => c.url.endsWith("/api/jobs"));
    const body = JSON.parse(job?.init?.body as string) as {
      command: string;
      typeOrUrl: string;
    };
    expect(body.command).toBe("knowledge.add");
    expect(body.typeOrUrl).toBe("https://example.com/p");
    // No /config PUT in the direct-HTTP path.
    const put = calls.find((c) => c.url.endsWith("/api/agents/a1/config"));
    expect(put).toBeUndefined();
  });
});
