import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { AgentDetail } from "gui-shared";
import { describe, expect, it } from "vitest";
import { AgentPermissionsView } from "./AgentPermissionsView";

function baseAgent(config: Record<string, unknown>): AgentDetail {
  return {
    name: "foo",
    description: "",
    catalog: "default",
    path: "/x",
    targets: ["opencode"],
    identity: "",
    expertise: "",
    soul: "",
    user: "",
    config,
  };
}

function renderWithAgent(detail: AgentDetail) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(["agents", detail.name], detail);
  return render(
    <QueryClientProvider client={qc}>
      <AgentPermissionsView agentName={detail.name} />
    </QueryClientProvider>,
  );
}

describe("AgentPermissionsView", () => {
  it("shows the 'no explicit permissions' empty state when config has no permission block", () => {
    renderWithAgent(baseAgent({}));
    expect(screen.getByText(/no explicit permissions set/i)).toBeInTheDocument();
    // Anti-regression: the misleading Phase 2 placeholder text must not appear.
    expect(screen.queryByText(/ships in phase 2/i)).not.toBeInTheDocument();
  });

  it("renders bare action groups with a chip", () => {
    renderWithAgent(
      baseAgent({
        permission: {
          edit: "ask",
          bash: "deny",
          read: "allow",
        },
      }),
    );
    expect(screen.getByText("edit")).toBeInTheDocument();
    expect(screen.getByText("bash")).toBeInTheDocument();
    expect(screen.getByText("read")).toBeInTheDocument();
    expect(screen.getByText("ask")).toBeInTheDocument();
    expect(screen.getByText("deny")).toBeInTheDocument();
    expect(screen.getByText("allow")).toBeInTheDocument();
  });

  it("renders per-pattern sub-records under their group", () => {
    renderWithAgent(
      baseAgent({
        permission: {
          skill: {
            "example-mcp": "allow",
            "secret-leaker": "deny",
          },
        },
      }),
    );
    expect(screen.getByText("skill")).toBeInTheDocument();
    expect(screen.getByText("example-mcp")).toBeInTheDocument();
    expect(screen.getByText("secret-leaker")).toBeInTheDocument();
    expect(screen.getByText("allow")).toBeInTheDocument();
    expect(screen.getByText("deny")).toBeInTheDocument();
  });

  it("shows the read-only footer pointing at the JSON path", () => {
    renderWithAgent(baseAgent({}));
    expect(screen.getByText(/Read-only\. Edit/)).toBeInTheDocument();
    // Path lives inside a <code> child so the surrounding "to modify"
    // sentence is split across nodes; assert on the path element directly.
    expect(screen.getByText("/x/agent.config.json")).toBeInTheDocument();
  });

  it("footer path comes from detail.path (not hardcoded)", () => {
    const detail = baseAgent({});
    detail.path = "/custom/agent-smith-home/agents/foo";
    renderWithAgent(detail);
    expect(
      screen.getByText("/custom/agent-smith-home/agents/foo/agent.config.json"),
    ).toBeInTheDocument();
  });
});
