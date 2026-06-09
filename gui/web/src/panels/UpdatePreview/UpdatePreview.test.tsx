import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mutate = vi.fn();
vi.mock("@/hooks/useStartJob", () => ({
  useStartJob: () => ({ mutate, isPending: false }),
}));

let q: {
  data?: {
    alreadyUpToDate: boolean;
    commitsBehind: number;
    rawOutput: string;
    installKind?: "source" | "packaged" | "unknown";
    updateAvailable?: boolean;
  };
  isLoading: boolean;
  isError: boolean;
  error?: unknown;
} = { isLoading: true, isError: false };
vi.mock("@/hooks/useUpdatePreview", () => ({
  useUpdatePreview: () => q,
}));

import { UpdatePreview } from "./UpdatePreview";

describe("UpdatePreview", () => {
  beforeEach(() => {
    mutate.mockClear();
  });

  it("shows loading state", () => {
    q = { isLoading: true, isError: false };
    render(<UpdatePreview />);
    expect(screen.getByText(/checking origin/)).toBeInTheDocument();
  });

  it("shows UP TO DATE when already up to date", () => {
    q = {
      isLoading: false,
      isError: false,
      data: { alreadyUpToDate: true, commitsBehind: 0, rawOutput: "Already up to date." },
    };
    render(<UpdatePreview />);
    expect(screen.getByText("UP TO DATE")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /run update/ })).not.toBeInTheDocument();
  });

  it("shows N BEHIND with enabled run button", () => {
    q = {
      isLoading: false,
      isError: false,
      data: { alreadyUpToDate: false, commitsBehind: 3, rawOutput: "would pull 3 commits" },
    };
    render(<UpdatePreview />);
    expect(screen.getByText("3 BEHIND")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /run update/ })).toBeEnabled();
  });

  it("dispatches update job on click", () => {
    q = {
      isLoading: false,
      isError: false,
      data: { alreadyUpToDate: false, commitsBehind: 2, rawOutput: "..." },
    };
    render(<UpdatePreview />);
    fireEvent.click(screen.getByRole("button", { name: /run update/ }));
    expect(mutate).toHaveBeenCalledWith({ command: "update", dryRun: false });
  });

  it("packaged + update available: shows UPDATE AVAILABLE, no git 'BEHIND', run button works", () => {
    q = {
      isLoading: false,
      isError: false,
      data: {
        alreadyUpToDate: false,
        commitsBehind: 0,
        rawOutput: "Update available. Upgrade with: npm install -g @eliharoun/agent-smith",
        installKind: "packaged",
        updateAvailable: true,
      },
    };
    render(<UpdatePreview />);
    expect(screen.getByText("UPDATE AVAILABLE")).toBeInTheDocument();
    expect(screen.queryByText(/BEHIND/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /run update/ }));
    expect(mutate).toHaveBeenCalledWith({ command: "update", dryRun: false });
  });

  it("packaged + up to date: shows UP TO DATE, no run button", () => {
    q = {
      isLoading: false,
      isError: false,
      data: {
        alreadyUpToDate: true,
        commitsBehind: 0,
        rawOutput: "Already up to date.",
        installKind: "packaged",
        updateAvailable: false,
      },
    };
    render(<UpdatePreview />);
    expect(screen.getByText("UP TO DATE")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /run update/ })).not.toBeInTheDocument();
  });

  it("renders error state", () => {
    q = { isLoading: false, isError: true, error: new Error("boom") };
    render(<UpdatePreview />);
    expect(screen.getByText(/preview failed/)).toBeInTheDocument();
    expect(screen.getByText(/boom/)).toBeInTheDocument();
  });
});
