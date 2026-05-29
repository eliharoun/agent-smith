import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const putAsync = vi.fn().mockResolvedValue(undefined);
let envData: { pullIntervalMs?: number; heartbeatIntervalMs?: number } | undefined;

vi.mock("@/hooks/useSmithEnv", () => ({
  useSmithEnv: () => ({ data: envData, isLoading: envData === undefined }),
  usePutSmithEnv: () => ({ mutateAsync: putAsync, isPending: false }),
}));

const startAsync = vi.fn().mockResolvedValue(undefined);
vi.mock("@/hooks/useStartJob", () => ({
  useStartJob: () => ({ mutateAsync: startAsync, isPending: false }),
}));

import { SmithEnvForm } from "./SmithEnvForm";

describe("SmithEnvForm", () => {
  beforeEach(() => {
    putAsync.mockClear();
    startAsync.mockClear();
    envData = { pullIntervalMs: 60000 };
  });

  it("populates inputs from server values", () => {
    render(<SmithEnvForm />);
    expect(screen.getByDisplayValue("60000")).toBeInTheDocument();
  });

  it("rejects non-integer input and disables save", () => {
    render(<SmithEnvForm />);
    const pullInput = screen.getByDisplayValue("60000") as HTMLInputElement;
    fireEvent.change(pullInput, { target: { value: "12.5" } });
    expect(screen.getByText(/positive integer/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^save$/ })).toBeDisabled();
  });

  it("PUTs camelCase payload on save and shows restart prompt", async () => {
    envData = {};
    render(<SmithEnvForm />);
    const inputs = screen.getAllByRole("textbox") as HTMLInputElement[];
    fireEvent.change(inputs[0]!, { target: { value: "5000" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/ }));
    await waitFor(() => {
      expect(putAsync).toHaveBeenCalledWith({ pullIntervalMs: 5000 });
    });
    expect(await screen.findByText(/saved — restart daemon to apply/)).toBeInTheDocument();
  });

  it("restart now dispatches daemon.stop then daemon.start", async () => {
    envData = {};
    render(<SmithEnvForm />);
    fireEvent.change(screen.getAllByRole("textbox")[0]!, { target: { value: "5000" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/ }));
    const restartBtn = await screen.findByRole("button", { name: /restart now/ });
    fireEvent.click(restartBtn);
    await waitFor(() => {
      expect(startAsync).toHaveBeenCalledWith({ command: "daemon.stop" });
      expect(startAsync).toHaveBeenCalledWith({ command: "daemon.start" });
    });
  });
});
