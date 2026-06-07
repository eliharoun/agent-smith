import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { AgentDestroyButton } from "./AgentDestroyButton";

describe("AgentDestroyButton", () => {
  it("opens the destroy modal with typed-token confirmation", () => {
    global.fetch = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ agent: "foo", installed: {} }), { status: 200 }),
      ),
    ) as unknown as typeof fetch;
    sessionStorage.setItem("smith.gui.token", "t");
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <AgentDestroyButton name="foo" />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /destroy/i }));
    // New modal: typed-token gating + orphan-file rationale
    expect(screen.getByPlaceholderText("foo")).toBeInTheDocument();
    expect(screen.getByText(/dangling agent definitions/i)).toBeInTheDocument();
  });

  it("renders nothing for a protected agent (system bundle)", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <AgentDestroyButton name="agent-smith" protected />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(container.querySelector("button")).toBeNull();
    expect(screen.queryByRole("button", { name: /destroy/i })).toBeNull();
  });
});
