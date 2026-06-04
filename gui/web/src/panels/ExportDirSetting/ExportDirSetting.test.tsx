import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ExportDirSetting } from "./ExportDirSetting";

function makeFetch(opts: { initialDir?: string } = {}) {
  const calls: { method: string; body?: unknown }[] = [];
  const initialDir = opts.initialDir ?? "";
  const fetchMock = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const body = {
      schemaVersion: 1,
      tourCompleted: false,
      lastSeenVersion: "x",
      mode: "guided",
      theme: { intensity: "medium" },
      port: 7777,
      exportDir: method === "PUT" ? "/Users/me/Exports" : initialDir,
    };
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return calls;
}

function renderPanel() {
  sessionStorage.setItem("smith.gui.token", "t");
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <ExportDirSetting />
    </QueryClientProvider>,
  );
}

describe("ExportDirSetting", () => {
  it("shows the default hint when exportDir is empty", async () => {
    makeFetch({ initialDir: "" });
    renderPanel();
    await waitFor(() => expect(screen.getByText(/current: \(default: ~\/Downloads\)/)).toBeInTheDocument());
  });

  it("shows the configured path when exportDir is set", async () => {
    makeFetch({ initialDir: "/Users/me/Exports" });
    renderPanel();
    await waitFor(() => expect(screen.getByText(/current: \/Users\/me\/Exports/)).toBeInTheDocument());
  });

  it("PUTs the new path on save and clears the input", async () => {
    const calls = makeFetch({ initialDir: "" });
    renderPanel();
    await waitFor(() => expect(screen.getByText(/current:/)).toBeInTheDocument());

    const input = screen.getByLabelText(/next save/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "/Users/me/Exports" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true));
    expect(calls.find((c) => c.method === "PUT")?.body).toEqual({ exportDir: "/Users/me/Exports" });
    await waitFor(() =>
      expect((screen.getByLabelText(/next save/i) as HTMLInputElement).value).toBe(""),
    );
  });

  it("accepts an empty value (resets to default)", async () => {
    const calls = makeFetch({ initialDir: "/Users/me/Exports" });
    renderPanel();
    await waitFor(() => expect(screen.getByText(/current: \/Users\/me\/Exports/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true));
    expect(calls.find((c) => c.method === "PUT")?.body).toEqual({ exportDir: "" });
  });

  it("rejects relative paths with inline validation", async () => {
    makeFetch();
    renderPanel();
    await waitFor(() => expect(screen.getByText(/current:/)).toBeInTheDocument());
    const input = screen.getByLabelText(/next save/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "relative/path" } });
    fireEvent.blur(input);
    expect(screen.getByRole("button", { name: /save/i })).toBeDisabled();
  });
});
