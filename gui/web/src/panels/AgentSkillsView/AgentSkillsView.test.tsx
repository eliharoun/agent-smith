import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { AgentDetail } from "gui-shared";
import { describe, expect, it } from "vitest";
import { AgentSkillsView } from "./AgentSkillsView";

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
      <AgentSkillsView agentName={detail.name} />
    </QueryClientProvider>,
  );
}

describe("AgentSkillsView", () => {
  it("shows the 'no required skills' empty state when requires.skills is absent", () => {
    renderWithAgent(baseAgent({}));
    expect(screen.getByText(/no required skills declared/i)).toBeInTheDocument();
    expect(screen.queryByText(/ships in phase 2/i)).not.toBeInTheDocument();
  });

  it("renders each required skill with optional catalog suffix", () => {
    renderWithAgent(
      baseAgent({
        requires: {
          skills: [{ name: "tdd" }, { catalog: "superpowers", name: "brainstorming" }],
        },
      }),
    );
    expect(screen.getByText("tdd")).toBeInTheDocument();
    expect(screen.getByText("brainstorming")).toBeInTheDocument();
    expect(screen.getByText("[superpowers]")).toBeInTheDocument();
  });

  it("filters out malformed entries defensively", () => {
    renderWithAgent(
      baseAgent({
        requires: {
          skills: [
            { name: "good" },
            { catalog: 123, name: "bad" }, // catalog wrong type
            { name: 99 }, // name wrong type
            "not-an-object",
          ],
        },
      }),
    );
    expect(screen.getByText("good")).toBeInTheDocument();
    expect(screen.queryByText("bad")).not.toBeInTheDocument();
  });

  it("shows the read-only footer pointing at the JSON path", () => {
    renderWithAgent(baseAgent({}));
    expect(screen.getByText(/Read-only\. Edit/)).toBeInTheDocument();
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
