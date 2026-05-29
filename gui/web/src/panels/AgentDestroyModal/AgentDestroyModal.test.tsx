import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { AgentDestroyModal } from "./AgentDestroyModal";

function wrap(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

function mockInstalled(targets: Record<string, boolean>) {
  global.fetch = vi.fn((url: RequestInfo | URL) => {
    const u = String(url);
    if (u.includes("/installed-status")) {
      return Promise.resolve(
        new Response(JSON.stringify({ agent: "my-agent", installed: targets }), {
          status: 200,
        }),
      );
    }
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as unknown as typeof fetch;
}

describe("AgentDestroyModal", () => {
  it("disables Destroy until typed token matches agent name", () => {
    mockInstalled({});
    sessionStorage.setItem("smith.gui.token", "t");
    wrap(<AgentDestroyModal agentName="my-agent" open onClose={() => {}} />);
    const btn = screen.getByRole("button", { name: /^destroy$/i });
    expect(btn.hasAttribute("disabled")).toBe(true);
    const input = screen.getByPlaceholderText("my-agent");
    fireEvent.change(input, { target: { value: "my-agent" } });
    expect(btn.hasAttribute("disabled")).toBe(false);
  });

  it("explains orphan-file risk in info text", () => {
    mockInstalled({});
    sessionStorage.setItem("smith.gui.token", "t");
    wrap(<AgentDestroyModal agentName="x" open onClose={() => {}} />);
    expect(screen.getByText(/dangling agent definitions/i)).toBeTruthy();
  });

  it("dispatches agent.destroy job with force=true on confirm", async () => {
    mockInstalled({});
    sessionStorage.setItem("smith.gui.token", "t");
    const onDispatch = vi.fn();
    wrap(<AgentDestroyModal agentName="x" open onClose={() => {}} onDispatch={onDispatch} />);
    fireEvent.change(screen.getByPlaceholderText("x"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: /^destroy$/i }));
    await waitFor(() =>
      expect(onDispatch).toHaveBeenCalledWith({
        command: "agent.destroy",
        name: "x",
        confirmName: "x",
        force: true,
      }),
    );
  });

  it("lists currently-installed platforms when fetch returns them", async () => {
    mockInstalled({ opencode: true, "claude-code": false, codex: true });
    sessionStorage.setItem("smith.gui.token", "t");
    wrap(<AgentDestroyModal agentName="my-agent" open onClose={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText(/\[✓\] opencode/)).toBeInTheDocument();
    });
    expect(screen.getByText(/\[✓\] codex/)).toBeInTheDocument();
    expect(screen.queryByText(/\[✓\] claude-code/)).not.toBeInTheDocument();
  });

  it("renders nothing when open=false", () => {
    mockInstalled({});
    sessionStorage.setItem("smith.gui.token", "t");
    const { container } = wrap(<AgentDestroyModal agentName="x" open={false} onClose={() => {}} />);
    expect(container.textContent).toBe("");
  });

  it("clears typed token when the modal closes", () => {
    mockInstalled({});
    sessionStorage.setItem("smith.gui.token", "t");
    const { rerender } = wrap(<AgentDestroyModal agentName="my-agent" open onClose={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText("my-agent"), {
      target: { value: "my-agent" },
    });
    expect((screen.getByRole("button", { name: /^destroy$/i }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    // Close
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <AgentDestroyModal agentName="my-agent" open={false} onClose={() => {}} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    // Reopen
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <AgentDestroyModal agentName="my-agent" open onClose={() => {}} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect((screen.getByRole("button", { name: /^destroy$/i }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((screen.getByPlaceholderText("my-agent") as HTMLInputElement).value).toBe("");
  });
});
