import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mutate = vi.fn();
vi.mock("@/hooks/useStartJob", () => ({
  useStartJob: () => ({ mutate, isPending: false }),
}));

type DoctorData =
  | undefined
  | { exitCode: number; knowledgeRefresh?: { findings?: Array<{ kind: string; path?: string }> } }
  | { error: string };
let data: DoctorData;
vi.mock("@/hooks/useDoctor", () => ({
  useDoctor: () => ({ data }),
}));

import { CodexMigrationBanner } from "./CodexMigrationBanner";

describe("CodexMigrationBanner", () => {
  beforeEach(() => {
    mutate.mockClear();
  });

  it("renders nothing when no findings", () => {
    data = { exitCode: 0, knowledgeRefresh: { findings: [] } };
    const { container } = render(<CodexMigrationBanner />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing on refusal response", () => {
    data = { error: "no-platform-detected" };
    const { container } = render(<CodexMigrationBanner />);
    expect(container.firstChild).toBeNull();
  });

  it("renders banner when unmanaged-codex-hooks finding present", () => {
    data = {
      exitCode: 1,
      knowledgeRefresh: {
        findings: [{ kind: "unmanaged-codex-hooks", path: "/home/u/.codex/hooks.json" }],
      },
    };
    render(<CodexMigrationBanner />);
    expect(screen.getByText(/codex hooks detected/)).toBeInTheDocument();
    expect(screen.getByText("/home/u/.codex/hooks.json")).toBeInTheDocument();
  });

  it("dispatches knowledge.migrate-codex job on click", () => {
    data = {
      exitCode: 1,
      knowledgeRefresh: {
        findings: [{ kind: "unmanaged-codex-hooks", path: "/x" }],
      },
    };
    render(<CodexMigrationBanner />);
    fireEvent.click(screen.getByRole("button", { name: /migrate codex hooks/ }));
    expect(mutate).toHaveBeenCalledWith({ command: "knowledge.migrate-codex" });
  });
});
