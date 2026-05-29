import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── shared mock state ────────────────────────────────────────────
type Row = {
  id: string;
  command: string;
  argvPreview: string;
  startedAt: number;
  endedAt: number;
  exitCode: number;
  durationMs: number;
  outputAvailable: boolean;
  degraded?: boolean;
  warnings?: string[];
};
let rows: Row[] = [];
let listLoading = false;
let listError: unknown = null;

vi.mock("@/hooks/useJobHistory", () => ({
  useJobHistory: () => ({ data: rows, isLoading: listLoading, error: listError }),
  useJobOutput: (id: string | null) => ({
    data: id ? "captured output line 1\ncaptured output line 2\n" : undefined,
    isLoading: false,
    error: null,
  }),
}));

let searchResults: Array<{ jobId: string; lineNumber: number; matchedLine: string }> = [];
let searchLoading = false;
vi.mock("@/hooks/useJobHistorySearch", () => ({
  useJobHistorySearch: (q: string) => ({
    data: q.length >= 2 ? searchResults : undefined,
    isLoading: q.length >= 2 ? searchLoading : false,
  }),
}));

import { JobHistoryTable } from "./JobHistoryTable";
import { JobOutputDrawer } from "./JobOutputDrawer";
import { JobSearchBar } from "./JobSearchBar";

beforeEach(() => {
  rows = [];
  listLoading = false;
  listError = null;
  searchResults = [];
  searchLoading = false;
});

describe("JobHistoryTable", () => {
  it("renders empty state when no rows", () => {
    render(<JobHistoryTable onSelect={() => {}} />);
    expect(screen.getByText(/no jobs recorded/)).toBeInTheDocument();
  });

  it("renders rows with command preview, duration, and exit code", () => {
    rows = [
      {
        id: "j1",
        command: "skill.install",
        argvPreview: "smith skill install team/foo",
        startedAt: 0,
        endedAt: Date.now(),
        exitCode: 0,
        durationMs: 1200,
        outputAvailable: true,
      },
      {
        id: "j2",
        command: "doctor",
        argvPreview: "smith doctor",
        startedAt: 0,
        endedAt: Date.now() - 86_400_000,
        exitCode: 1,
        durationMs: 800,
        outputAvailable: false,
      },
    ];
    render(<JobHistoryTable onSelect={() => {}} />);
    expect(screen.getByText("smith skill install team/foo")).toBeInTheDocument();
    expect(screen.getByText("smith doctor")).toBeInTheDocument();
    expect(screen.getByText("1.2s")).toBeInTheDocument();
    expect(screen.getByText("expired")).toBeInTheDocument();
  });

  it("calls onSelect only for rows with outputAvailable", () => {
    const onSelect = vi.fn();
    rows = [
      {
        id: "j1",
        command: "doctor",
        argvPreview: "smith doctor",
        startedAt: 0,
        endedAt: Date.now(),
        exitCode: 0,
        durationMs: 100,
        outputAvailable: true,
      },
      {
        id: "j2",
        command: "doctor",
        argvPreview: "smith doctor (old)",
        startedAt: 0,
        endedAt: Date.now(),
        exitCode: 0,
        durationMs: 100,
        outputAvailable: false,
      },
    ];
    render(<JobHistoryTable onSelect={onSelect} />);
    fireEvent.click(screen.getByText("smith doctor"));
    expect(onSelect).toHaveBeenCalledWith("j1");
    onSelect.mockClear();
    fireEvent.click(screen.getByText("smith doctor (old)"));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("renders amber chip for degraded (succeeded with warnings) jobs", () => {
    rows = [
      {
        id: "j1",
        command: "knowledge.fetch",
        argvPreview: "smith knowledge fetch",
        startedAt: 0,
        endedAt: Date.now(),
        exitCode: 0,
        durationMs: 500,
        outputAvailable: true,
        degraded: true,
        warnings: ["warn: confluence page not reachable"],
      },
    ];
    render(<JobHistoryTable onSelect={() => {}} />);
    const chip = screen.getByText("0");
    expect(chip.className).toContain("amber");
  });
});

describe("JobOutputDrawer", () => {
  it("renders captured output and close button", () => {
    const onClose = vi.fn();
    render(<JobOutputDrawer jobId="j1" onClose={onClose} />);
    expect(screen.getByText(/captured output line 1/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("[close]"));
    expect(onClose).toHaveBeenCalled();
  });
});

describe("JobSearchBar", () => {
  it("does not show results below 2 characters", () => {
    render(<JobSearchBar onJump={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText(/search past job output/), {
      target: { value: "a" },
    });
    expect(screen.queryByText(/searching/)).not.toBeInTheDocument();
  });

  it("shows search hits after debounce window and jumps on click", async () => {
    vi.useFakeTimers();
    searchResults = [{ jobId: "j1", lineNumber: 42, matchedLine: "panic: bad thing" }];
    const onJump = vi.fn();
    render(<JobSearchBar onJump={onJump} />);
    fireEvent.change(screen.getByPlaceholderText(/search past job output/), {
      target: { value: "panic" },
    });
    // advance through 300ms debounce
    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
    });
    vi.useRealTimers();
    expect(screen.getByText(/panic: bad thing/)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/panic: bad thing/));
    expect(onJump).toHaveBeenCalledWith("j1");
  });
});
