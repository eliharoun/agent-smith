import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { YouAreIn } from "./YouAreIn";

function setup(onDone: () => Promise<void>) {
  return render(
    <MemoryRouter initialEntries={["/onboarding"]}>
      <Routes>
        <Route path="/onboarding" element={<YouAreIn onDone={onDone} />} />
        <Route path="/" element={<div data-testid="dashboard">dashboard</div>} />
        <Route path="/agents" element={<div data-testid="agents">agents</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("YouAreIn", () => {
  afterEach(() => vi.restoreAllMocks());

  it("awaits onDone before navigating to Dashboard", async () => {
    const order: string[] = [];
    let resolveDone!: () => void;
    const onDone = vi.fn(
      () =>
        new Promise<void>((r) => {
          resolveDone = () => {
            order.push("done");
            r();
          };
        }),
    );
    setup(onDone);
    fireEvent.click(screen.getByRole("button", { name: /dashboard/i }));
    expect(onDone).toHaveBeenCalled();
    // dashboard should NOT be present before onDone resolves.
    expect(screen.queryByTestId("dashboard")).toBeNull();
    resolveDone();
    expect(await screen.findByTestId("dashboard")).toBeInTheDocument();
    order.push("nav");
    expect(order).toEqual(["done", "nav"]);
  });

  it("awaits onDone before navigating to Agents", async () => {
    const onDone = vi.fn(async () => {});
    setup(onDone);
    fireEvent.click(screen.getByRole("button", { name: /agents/i }));
    expect(onDone).toHaveBeenCalled();
    expect(await screen.findByTestId("agents")).toBeInTheDocument();
  });
});
