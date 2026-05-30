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
    });
  });
});
