import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { McpWiringModal } from "./McpWiringModal";

interface PlanResponse {
  platforms: Array<{
    platform: "opencode" | "claude-code" | "codex" | "kiro";
    cliInstalled: boolean;
    configPath: string;
    hasEntry: boolean;
    configReadable: boolean;
  }>;
}

function mockPlanFetch(plan: PlanResponse) {
  return async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.endsWith("/mcp-wiring-plan")) {
      return new Response(JSON.stringify(plan), { status: 200 });
    }
    return new Response("not found", { status: 404 });
  };
}

describe("McpWiringModal", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the verb 'Wire' with target count when enable=true", async () => {
    globalThis.fetch = mockPlanFetch({
      platforms: [
        {
          platform: "claude-code",
          cliInstalled: true,
          configPath: "/home/user/.claude.json",
          hasEntry: false,
          configReadable: true,
        },
        {
          platform: "kiro",
          cliInstalled: true,
          configPath: "/home/user/.kiro/settings/mcp.json",
          hasEntry: false,
          configReadable: true,
        },
        {
          platform: "opencode",
          cliInstalled: false,
          configPath: "/home/user/.config/opencode/opencode.json",
          hasEntry: false,
          configReadable: true,
        },
        {
          platform: "codex",
          cliInstalled: false,
          configPath: "/home/user/.codex/config.toml",
          hasEntry: false,
          configReadable: true,
        },
      ],
    }) as unknown as typeof fetch;
    render(
      <McpWiringModal
        agent="testing-agent"
        enable={true}
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    );
    await waitFor(() =>
      expect(screen.getByText(/wire knowledge mcp server for testing-agent/i)).toBeInTheDocument(),
    );
    // Two CLI-detected platforms.
    expect(screen.getByRole("button", { name: /^wire 2 platforms/i })).toBeInTheDocument();
    // Skipped platforms shown with "CLI not detected".
    const cliNotDetected = screen.getAllByText(/cli not detected/i);
    expect(cliNotDetected.length).toBe(2);
  });

  it("renders 'Unwire' verb when enable=false and reflects hasEntry-based targeting", async () => {
    globalThis.fetch = mockPlanFetch({
      platforms: [
        {
          platform: "claude-code",
          cliInstalled: true,
          configPath: "/x",
          hasEntry: true,
          configReadable: true,
        },
        {
          platform: "kiro",
          cliInstalled: true,
          configPath: "/y",
          hasEntry: false, // already not wired — no-op
          configReadable: true,
        },
      ],
    }) as unknown as typeof fetch;
    render(
      <McpWiringModal agent="foo" enable={false} onCancel={() => {}} onConfirm={() => {}} />,
    );
    await waitFor(() =>
      expect(screen.getByText(/unwire knowledge mcp server for foo/i)).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: /^unwire 1 platform/i })).toBeInTheDocument();
  });

  it("calls onConfirm with the targeted platform names", async () => {
    globalThis.fetch = mockPlanFetch({
      platforms: [
        {
          platform: "claude-code",
          cliInstalled: true,
          configPath: "/x",
          hasEntry: false,
          configReadable: true,
        },
      ],
    }) as unknown as typeof fetch;
    const onConfirm = vi.fn();
    render(
      <McpWiringModal
        agent="testing-agent"
        enable={true}
        onCancel={() => {}}
        onConfirm={onConfirm}
      />,
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^wire 1 platform/i })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /^wire 1 platform/i }));
    expect(onConfirm).toHaveBeenCalledWith(["claude-code"]);
  });

  it("calls onCancel when the cancel button is clicked", async () => {
    globalThis.fetch = mockPlanFetch({ platforms: [] }) as unknown as typeof fetch;
    const onCancel = vi.fn();
    render(
      <McpWiringModal agent="foo" enable={true} onCancel={onCancel} onConfirm={() => {}} />,
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^cancel$/i })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(onCancel).toHaveBeenCalled();
  });
});
