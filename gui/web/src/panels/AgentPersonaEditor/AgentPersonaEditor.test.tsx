import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AgentPersonaEditor } from "./AgentPersonaEditor";

function renderWithClient(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { qc, ...render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>) };
}

describe("AgentPersonaEditor", () => {
  it("renders the content prop in a textarea and starts in 'saved' state", () => {
    sessionStorage.setItem("smith.gui.token", "t");
    renderWithClient(
      <AgentPersonaEditor name="foo" file="IDENTITY" title="IDENTITY.md" content="hello" />,
    );
    const textarea = screen.getByLabelText(/IDENTITY\.md content/i) as HTMLTextAreaElement;
    expect(textarea.value).toBe("hello");
    expect(screen.getByText(/\/\/ saved/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save/i })).toBeDisabled();
  });

  it("enables Save once the textarea is edited and shows 'unsaved changes'", () => {
    sessionStorage.setItem("smith.gui.token", "t");
    renderWithClient(
      <AgentPersonaEditor name="foo" file="IDENTITY" title="IDENTITY.md" content="hello" />,
    );
    const textarea = screen.getByLabelText(/IDENTITY\.md content/i) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "hello world" } });
    expect(screen.getByText(/\/\/ unsaved changes/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save/i })).not.toBeDisabled();
  });

  it("PUTs to /api/agents/:name/persona/:file and invalidates the agent detail query on success", async () => {
    sessionStorage.setItem("smith.gui.token", "t");
    const calls: { url: string; method: string; body?: unknown }[] = [];
    global.fetch = vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      calls.push({
        url: String(url),
        method,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    }) as unknown as typeof fetch;

    const { qc } = renderWithClient(
      <AgentPersonaEditor name="foo" file="EXPERTISE" title="EXPERTISE.md" content="initial" />,
    );
    // Seed a cached agent detail so we can observe the invalidation.
    qc.setQueryData(["agents", "foo"], { name: "foo" });
    const before = qc.getQueryState(["agents", "foo"])?.dataUpdatedAt;

    const textarea = screen.getByLabelText(/EXPERTISE\.md content/i) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "updated body" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true));
    const put = calls.find((c) => c.method === "PUT")!;
    expect(put.url).toContain("/api/agents/foo/persona/EXPERTISE");
    expect(put.body).toEqual({ content: "updated body" });

    // invalidation marks the cached query stale; isInvalidated flips to true
    await waitFor(() => {
      expect(qc.getQueryState(["agents", "foo"])?.isInvalidated).toBe(true);
    });
    expect(before).toBeDefined();
  });

  it("shows an inline error message when save fails", async () => {
    sessionStorage.setItem("smith.gui.token", "t");
    global.fetch = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: "disk full", code: "WRITE_FAILED" }), {
          status: 500,
        }),
      ),
    ) as unknown as typeof fetch;

    renderWithClient(<AgentPersonaEditor name="foo" file="SOUL" title="SOUL.md" content="x" />);
    const textarea = screen.getByLabelText(/SOUL\.md content/i) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "y" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => {
      expect(screen.getByText(/error: disk full/i)).toBeInTheDocument();
    });
  });
});
