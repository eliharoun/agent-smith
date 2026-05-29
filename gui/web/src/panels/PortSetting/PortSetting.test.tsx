import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PortSetting } from "./PortSetting";

function makeFetch(opts: { putStatus?: number; putError?: boolean } = {}) {
  const calls: { method: string; body?: unknown }[] = [];
  const fetchMock = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (method === "PUT") {
      if (opts.putError) {
        return Promise.resolve(
          new Response(JSON.stringify({ error: "boom", code: "INTERNAL" }), {
            status: opts.putStatus ?? 500,
          }),
        );
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            schemaVersion: 1,
            tourCompleted: false,
            lastSeenVersion: "x",
            mode: "guided",
            theme: { intensity: "medium" },
            port: 9000,
          }),
          { status: 200 },
        ),
      );
    }
    return Promise.resolve(
      new Response(
        JSON.stringify({
          schemaVersion: 1,
          tourCompleted: false,
          lastSeenVersion: "x",
          mode: "guided",
          theme: { intensity: "medium" },
          port: 7777,
        }),
        { status: 200 },
      ),
    );
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return calls;
}

function renderPort() {
  sessionStorage.setItem("smith.gui.token", "t");
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <PortSetting />
    </QueryClientProvider>,
  );
}

describe("PortSetting", () => {
  it("renders current port and saves a valid value via settings PUT", async () => {
    const calls = makeFetch();
    renderPort();
    await waitFor(() => expect(screen.getByText(/current: 7777/)).toBeInTheDocument());

    const input = screen.getByLabelText(/next launch/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "9000" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true));
    expect(calls.find((c) => c.method === "PUT")?.body).toEqual({ port: 9000 });
    // input clears on success
    await waitFor(() =>
      expect((screen.getByLabelText(/next launch/i) as HTMLInputElement).value).toBe(""),
    );
  });

  it("disables Save and shows no PUT for empty input", async () => {
    const calls = makeFetch();
    renderPort();
    await waitFor(() => expect(screen.getByText(/current: 7777/)).toBeInTheDocument());
    const saveBtn = screen.getByRole("button", { name: /save/i }) as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);
    fireEvent.click(saveBtn);
    // no PUT should fire
    expect(calls.some((c) => c.method === "PUT")).toBe(false);
  });

  it("rejects non-numeric input with inline validation", async () => {
    makeFetch();
    renderPort();
    await waitFor(() => expect(screen.getByText(/current: 7777/)).toBeInTheDocument());
    const input = screen.getByLabelText(/next launch/i) as HTMLInputElement;
    // number input strips letters, so simulate via fireEvent + a non-number value bypassing the dom restriction
    // jsdom permits the value here; component validation should reject
    fireEvent.change(input, { target: { value: "abc" } });
    fireEvent.blur(input);
    expect(screen.getByRole("button", { name: /save/i })).toBeDisabled();
  });

  it("rejects negative numbers", async () => {
    makeFetch();
    renderPort();
    await waitFor(() => expect(screen.getByText(/current: 7777/)).toBeInTheDocument());
    const input = screen.getByLabelText(/next launch/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "-1" } });
    fireEvent.blur(input);
    expect(screen.getByRole("button", { name: /save/i })).toBeDisabled();
  });

  it("rejects port 0", async () => {
    makeFetch();
    renderPort();
    await waitFor(() => expect(screen.getByText(/current: 7777/)).toBeInTheDocument());
    const input = screen.getByLabelText(/next launch/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "0" } });
    fireEvent.blur(input);
    expect(screen.getByRole("button", { name: /save/i })).toBeDisabled();
  });

  it("rejects port > 65535", async () => {
    makeFetch();
    renderPort();
    await waitFor(() => expect(screen.getByText(/current: 7777/)).toBeInTheDocument());
    const input = screen.getByLabelText(/next launch/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "70000" } });
    fireEvent.blur(input);
    expect(screen.getByRole("button", { name: /save/i })).toBeDisabled();
  });

  it("surfaces mutation error in the UI", async () => {
    makeFetch({ putError: true, putStatus: 500 });
    renderPort();
    await waitFor(() => expect(screen.getByText(/current: 7777/)).toBeInTheDocument());
    const input = screen.getByLabelText(/next launch/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "8080" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(screen.getByText(/\/\/ error:/)).toBeInTheDocument());
  });
});
