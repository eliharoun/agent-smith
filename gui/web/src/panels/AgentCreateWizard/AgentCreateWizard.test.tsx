import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentCreateWizard } from "./AgentCreateWizard";

const mutateAsync = vi.fn().mockResolvedValue(undefined);
vi.mock("@/hooks/useStartJob", () => ({
  useStartJob: () => ({ mutateAsync, isPending: false }),
}));

vi.mock("@/store/mode", () => ({
  useModeStore: (selector: (s: { mode: string }) => unknown) => selector({ mode: "expert" }),
}));

function renderWizard() {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <AgentCreateWizard />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function fillName(value: string) {
  fireEvent.change(screen.getByRole("textbox", { name: /name/i }), {
    target: { value },
  });
}

function fillDescription(value: string) {
  fireEvent.change(screen.getByRole("textbox", { name: /description/i }), {
    target: { value },
  });
}

describe("AgentCreateWizard", () => {
  beforeEach(() => {
    mutateAsync.mockClear();
  });

  it("disables Create until name is valid AND description is 10-200 chars", () => {
    renderWizard();
    const btn = screen.getByRole("button", { name: /create/i });
    expect(btn).toBeDisabled();

    fillName("good-name");
    expect(btn).toBeDisabled(); // description still empty

    fillDescription("too short");
    expect(btn).toBeDisabled(); // 9 chars

    fillDescription("just enough");
    expect(btn).toBeEnabled();

    fillDescription("x".repeat(201));
    expect(btn).toBeDisabled();

    fillDescription("x".repeat(200));
    expect(btn).toBeEnabled();
  });

  it("shows length error when description is shorter than 10 chars", () => {
    renderWizard();
    fillDescription("nope");
    expect(screen.getByText(/at least 10 characters/)).toBeInTheDocument();
  });

  it("shows length error when description is longer than 200 chars", () => {
    renderWizard();
    fillDescription("x".repeat(201));
    expect(screen.getByText(/at most 200 characters/)).toBeInTheDocument();
  });

  it("includes --description in CLI preview when description is set", () => {
    renderWizard();
    fillName("good-name");
    fillDescription("A helpful agent for tutoring");
    expect(
      screen.getByText(
        /--description "A helpful agent for tutoring"|--description A helpful agent for tutoring/,
      ),
    ).toBeInTheDocument();
  });

  it("forwards description to the job request on Create", async () => {
    renderWizard();
    fillName("good-name");
    fillDescription("A helpful agent for tutoring");
    fireEvent.click(screen.getByRole("button", { name: /create/i }));
    expect(mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "agent.init",
        name: "good-name",
        description: "A helpful agent for tutoring",
      }),
    );
  });
});
