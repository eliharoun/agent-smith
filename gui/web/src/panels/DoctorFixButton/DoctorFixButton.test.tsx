import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mutate = vi.fn();
vi.mock("@/hooks/useStartJob", () => ({
  useStartJob: () => ({ mutate, isPending: false }),
}));

let data: unknown;
vi.mock("@/hooks/useDoctor", () => ({
  useDoctor: () => ({ data }),
}));

import { DoctorFixButton } from "./DoctorFixButton";

describe("DoctorFixButton", () => {
  beforeEach(() => {
    mutate.mockClear();
  });

  it("hides when no findings", () => {
    data = { exitCode: 0, knowledgeRefresh: { findings: [] } };
    const { container } = render(<DoctorFixButton />);
    expect(container.firstChild).toBeNull();
  });

  it("hides when only unmanaged-codex-hooks (not auto-fixable)", () => {
    data = {
      exitCode: 1,
      knowledgeRefresh: { findings: [{ kind: "unmanaged-codex-hooks" }] },
    };
    const { container } = render(<DoctorFixButton />);
    expect(container.firstChild).toBeNull();
  });

  it("shows when a fixable finding exists", () => {
    data = {
      exitCode: 1,
      knowledgeRefresh: { findings: [{ kind: "missing-hook" }] },
    };
    render(<DoctorFixButton />);
    expect(screen.getByRole("button", { name: /auto-repair/ })).toBeInTheDocument();
  });

  it("dispatches doctor job with fixKnowledgeRefresh: true", () => {
    data = {
      exitCode: 1,
      knowledgeRefresh: { findings: [{ kind: "corrupt-cache" }] },
    };
    render(<DoctorFixButton />);
    fireEvent.click(screen.getByRole("button", { name: /auto-repair/ }));
    expect(mutate).toHaveBeenCalledWith({
      command: "doctor",
      fixKnowledgeRefresh: true,
      fixKnowledgeCompile: false,
      fixKnowledgeIndex: false,
      fixMcpCommands: false,
    });
  });

  it("shows + dispatches fixKnowledgeIndex for a stale-index finding", () => {
    data = {
      exitCode: 0,
      knowledgeIndex: { status: "warn", findings: [{ kind: "stale-index", agent: "a" }] },
    };
    render(<DoctorFixButton />);
    fireEvent.click(screen.getByRole("button", { name: /stale knowledge index/ }));
    expect(mutate).toHaveBeenCalledWith({
      command: "doctor",
      fixKnowledgeRefresh: false,
      fixKnowledgeCompile: false,
      fixKnowledgeIndex: true,
      fixMcpCommands: false,
    });
  });

  it("hides for a missing-index-only finding (suggest-only, not auto-fixable)", () => {
    data = {
      exitCode: 0,
      knowledgeIndex: { status: "warn", findings: [{ kind: "missing-index", agent: "a" }] },
    };
    const { container } = render(<DoctorFixButton />);
    expect(container.firstChild).toBeNull();
  });

  it("shows when only mcp-spawn-commands findings exist", () => {
    data = {
      exitCode: 0,
      mcpSpawnCommands: {
        status: "fragile-spawn",
        findings: [{ platform: "kiro", serverName: "x", command: "smith" }],
      },
    };
    render(<DoctorFixButton />);
    expect(screen.getByRole("button", { name: /MCP spawn commands/ })).toBeInTheDocument();
  });

  it("dispatches doctor job with fixMcpCommands: true when only mcp findings exist", () => {
    data = {
      exitCode: 0,
      mcpSpawnCommands: {
        status: "fragile-spawn",
        findings: [{ platform: "kiro", serverName: "x", command: "smith" }],
      },
    };
    render(<DoctorFixButton />);
    fireEvent.click(screen.getByRole("button", { name: /MCP spawn commands/ }));
    expect(mutate).toHaveBeenCalledWith({
      command: "doctor",
      fixKnowledgeRefresh: false,
      fixKnowledgeCompile: false,
      fixKnowledgeIndex: false,
      fixMcpCommands: true,
    });
  });

  it("dispatches both flags when both fixable categories exist", () => {
    data = {
      exitCode: 1,
      knowledgeRefresh: { findings: [{ kind: "missing-hook" }] },
      mcpSpawnCommands: {
        status: "fragile-spawn",
        findings: [{ platform: "kiro", serverName: "x", command: "smith" }],
      },
    };
    render(<DoctorFixButton />);
    fireEvent.click(screen.getByRole("button", { name: /auto-repair/ }));
    expect(mutate).toHaveBeenCalledWith({
      command: "doctor",
      fixKnowledgeRefresh: true,
      fixKnowledgeCompile: false,
      fixKnowledgeIndex: false,
      fixMcpCommands: true,
    });
  });
});
