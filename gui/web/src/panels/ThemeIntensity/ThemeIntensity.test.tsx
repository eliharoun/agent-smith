import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ThemeIntensity } from "./ThemeIntensity";

describe("ThemeIntensity", () => {
  it("switches intensity on click", async () => {
    sessionStorage.setItem("smith.gui.token", "t");
    global.fetch = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "PUT") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              schemaVersion: 1,
              tourCompleted: false,
              lastSeenVersion: "x",
              mode: "guided",
              theme: { intensity: "low" },
              port: 7777,
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
    }) as unknown as typeof fetch;
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <ThemeIntensity />
      </QueryClientProvider>,
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /medium/i })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /low/i }));
  });
});
