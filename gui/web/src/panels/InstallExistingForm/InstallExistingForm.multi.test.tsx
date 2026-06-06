import { describe, expect, test, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { InstallExistingForm } from "./InstallExistingForm";

const onDispatch = vi.fn();

beforeEach(() => {
  onDispatch.mockReset();
  global.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({
      kind: "skill",
      bundles: [
        { name: "alpha", description: "A", alreadyInstalled: false },
        { name: "beta", description: "B", alreadyInstalled: false },
      ],
      detectedTargets: ["opencode", "kiro"],
      catalog: { suggestedLabel: "o/r", rootPath: "/x" },
      existingCatalog: null,
    }),
  })) as unknown as typeof fetch;
});

describe("InstallExistingForm (multi)", () => {
  test("resets to the URL step when closed and reopened", async () => {
    const { rerender } = render(<InstallExistingForm kind="skill" open onClose={() => {}} onDispatch={onDispatch} />);
    fireEvent.change(screen.getByLabelText(/where is the skill/i), { target: { value: "https://github.com/o/r" } });
    fireEvent.click(screen.getByRole("button", { name: /discover/i }));
    await waitFor(() => screen.getByText("alpha"));
    // Close then reopen
    rerender(<InstallExistingForm kind="skill" open={false} onClose={() => {}} onDispatch={onDispatch} />);
    rerender(<InstallExistingForm kind="skill" open onClose={() => {}} onDispatch={onDispatch} />);
    // Back to step 1: discover button present, no bundle list
    expect(screen.getByRole("button", { name: /discover/i })).toBeTruthy();
    expect(screen.queryByText("alpha")).toBeNull();
  });

  test("discovers, lets the user pick a subset, and dispatches one install job", async () => {
    render(<InstallExistingForm kind="skill" open onClose={() => {}} onDispatch={onDispatch} />);
    fireEvent.change(screen.getByLabelText(/where is the skill/i), { target: { value: "https://github.com/o/r" } });
    fireEvent.click(screen.getByRole("button", { name: /discover/i }));
    await waitFor(() => screen.getByText("alpha"));
    fireEvent.click(screen.getByLabelText("alpha"));
    fireEvent.click(screen.getByRole("button", { name: /install selected/i }));
    expect(onDispatch).toHaveBeenCalledTimes(1);
    const req = onDispatch.mock.calls[0]![0];
    expect(req.command).toBe("skill.install");
    expect(req.from).toBe("https://github.com/o/r");
    expect(req.skills).toEqual(["alpha"]);
    expect(req.targets).toEqual(["opencode", "kiro"]);
  });
});
