import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { UserMdEditor } from "./UserMdEditor";

describe("UserMdEditor", () => {
  it("loads content into textarea and saves edits via PUT", async () => {
    sessionStorage.setItem("smith.gui.token", "t");
    const calls: { method: string; body?: unknown }[] = [];
    global.fetch = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      calls.push({ method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (method === "PUT") {
        return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify({ content: "hello" }), { status: 200 }));
    }) as unknown as typeof fetch;

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <UserMdEditor />
      </QueryClientProvider>,
    );

    const textarea = (await screen.findByLabelText(/USER\.md content/i)) as HTMLTextAreaElement;
    await waitFor(() => expect(textarea.value).toBe("hello"));

    // initially saved (no diff)
    expect(screen.getByText(/\/\/ saved/)).toBeInTheDocument();

    fireEvent.change(textarea, { target: { value: "hello world" } });
    expect(screen.getByText(/\/\/ unsaved changes/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true));
    const putCall = calls.find((c) => c.method === "PUT");
    expect(putCall?.body).toEqual({ content: "hello world" });
  });
});
