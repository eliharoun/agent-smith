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
  bundleHasEntry: boolean;
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
      bundleHasEntry: false,
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
      bundleHasEntry: true,
    }) as unknown as typeof fetch;
    render(
      <McpWiringModal agent="foo" enable={false} onCancel={() => {}} onConfirm={() => {}} />,
    );
    // Wait on the button label itself — it transitions from the disabled
    // "Unwire 0 platforms" loading-state to "Unwire 1 platform" after the
    // fetch resolves. Waiting on the heading alone races the fetch.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^unwire 1 platform/i })).toBeInTheDocument(),
    );
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
      bundleHasEntry: false,
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

  it("renders Close-only button when bundleHasEntry matches the desired state and no targets remain", async () => {
    // True no-op: every CLI-detected platform already has the entry AND
    // the bundle's mcpServers array already contains the per-agent key.
    // The modal must render a single Close button (no Confirm) and skip
    // the bundle-config + followup sections.
    globalThis.fetch = mockPlanFetch({
      platforms: [
        {
          platform: "claude-code",
          cliInstalled: true,
          configPath: "/x",
          hasEntry: true,
          configReadable: true,
        },
      ],
      bundleHasEntry: true,
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
      expect(screen.getByRole("button", { name: /^close$/i })).toBeInTheDocument(),
    );
    expect(screen.getByText(/already in the desired state/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^cancel$/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/bundle reinstalled via/i)).not.toBeInTheDocument();
  });

  it("renders 'Save bundle config' label when only bundle config diff exists (no platform targets)", async () => {
    // bundleHasEntry=false + enable=true + every platform either
    // already-wired or CLI-not-detected → only the bundle-config write
    // is needed. Button should reflect that with a non-platform label.
    globalThis.fetch = mockPlanFetch({
      platforms: [
        {
          platform: "claude-code",
          cliInstalled: true,
          configPath: "/x",
          hasEntry: true, // already wired
          configReadable: true,
        },
      ],
      bundleHasEntry: false,
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
      expect(screen.getByRole("button", { name: /save bundle config/i })).toBeInTheDocument(),
    );
  });

  it("renders the per-agent key (not the legacy singleton) in the bundle-config diff", async () => {
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
      bundleHasEntry: false,
    }) as unknown as typeof fetch;
    render(
      <McpWiringModal agent="foo-bar" enable={true} onCancel={() => {}} onConfirm={() => {}} />,
    );
    await waitFor(() =>
      expect(screen.getByText(/"foo-bar-knowledge"/)).toBeInTheDocument(),
    );
  });

  it("calls onCancel when the cancel button is clicked", async () => {
    globalThis.fetch = mockPlanFetch({
      platforms: [],
      bundleHasEntry: false,
    }) as unknown as typeof fetch;
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
