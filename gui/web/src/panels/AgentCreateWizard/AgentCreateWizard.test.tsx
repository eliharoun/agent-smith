import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentCreateWizard } from "./AgentCreateWizard";

const onDispatch = vi.fn();
const onSuccess = vi.fn();

vi.mock("@/store/mode", () => ({
  useModeStore: (selector: (s: { mode: string }) => unknown) => selector({ mode: "expert" }),
}));

const mockMutate = vi.fn();
vi.mock("@/hooks/useStartJob", () => ({
  useStartJob: () => ({ mutate: mockMutate }),
}));

function renderWizard(props: { onDispatch?: typeof onDispatch; onSuccess?: typeof onSuccess } = {}) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <AgentCreateWizard
          {...(props.onDispatch ? { onDispatch: props.onDispatch } : {})}
          {...(props.onSuccess ? { onSuccess: props.onSuccess } : {})}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function renderWizardWithCallbacks() {
  return renderWizard({ onDispatch: onDispatch, onSuccess: onSuccess });
}

function fillName(value: string) {
  fireEvent.change(screen.getByRole("textbox", { name: /name/i }), { target: { value } });
}

function fillDescription(value: string) {
  fireEvent.change(screen.getByRole("textbox", { name: /description/i }), { target: { value } });
}

describe("AgentCreateWizard", () => {
  beforeEach(() => {
    onDispatch.mockClear();
    onSuccess.mockClear();
    mockMutate.mockClear();
  });

  it("disables 'create agent' until name is valid AND description is 10-200 chars", () => {
    renderWizard();
    const btn = screen.getByRole("button", { name: /create agent/i });
    expect(btn).toBeDisabled();
    fillName("good-name");
    expect(btn).toBeDisabled();
    fillDescription("too short");
    expect(btn).toBeDisabled();
    fillDescription("just enough");
    expect(btn).toBeEnabled();
    fillDescription("x".repeat(201));
    expect(btn).toBeDisabled();
    fillDescription("x".repeat(200));
    expect(btn).toBeEnabled();
  });

  it("shows length error when description is shorter than 10 chars (after blur)", () => {
    renderWizard();
    fillDescription("nope");
    expect(screen.queryByText(/at least 10 characters/)).toBeNull();
    fireEvent.blur(screen.getByRole("textbox", { name: /description/i }));
    expect(screen.getByText(/at least 10 characters/)).toBeInTheDocument();
  });

  it("shows length error when description is longer than 200 chars (after blur)", () => {
    renderWizard();
    fillDescription("x".repeat(201));
    fireEvent.blur(screen.getByRole("textbox", { name: /description/i }));
    expect(screen.getByText(/at most 200 characters/)).toBeInTheDocument();
  });

  it("shows live char counter on description field", () => {
    renderWizard();
    fillDescription("Hello world!!");
    expect(screen.getByText(/13\s*\/\s*200/)).toBeInTheDocument();
  });

  it("shows upfront helper text for name and description constraints", () => {
    renderWizard();
    expect(screen.getByText(/lowercase.*hyphens/i)).toBeInTheDocument();
    expect(screen.getByText(/10.*200/)).toBeInTheDocument();
  });

  it("renders 3-card gallery with Incident Debugger, Repo Cartographer, and Empty agent", () => {
    renderWizard();
    expect(screen.getByText(/incident debugger/i)).toBeInTheDocument();
    expect(screen.getByText(/repo cartographer/i)).toBeInTheDocument();
    expect(screen.getByText(/empty agent.*advanced/i)).toBeInTheDocument();
  });

  it("card descriptions are shown", () => {
    renderWizard();
    expect(screen.getByText(/logs and metrics/i)).toBeInTheDocument();
    expect(screen.getByText(/where-is-X/i)).toBeInTheDocument();
    expect(screen.getByText(/blank slate/i)).toBeInTheDocument();
  });

  it("clicking a card selects it (visual ring state)", () => {
    renderWizard();
    const card = screen.getByText(/repo cartographer/i).closest("button") as HTMLButtonElement;
    fireEvent.click(card);
    expect(card).toHaveAttribute("aria-pressed", "true");
  });

  it("calls onDispatch with agent.init job request on 'create agent' click (modal path)", () => {
    renderWizardWithCallbacks();
    fillName("good-name");
    fillDescription("A helpful agent for tutoring");
    fireEvent.click(screen.getByRole("button", { name: /create agent/i }));
    expect(onDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "agent.init",
        name: "good-name",
        description: "A helpful agent for tutoring",
      }),
    );
  });

  it("calls onSuccess with the agent name after dispatch (modal path)", () => {
    renderWizardWithCallbacks();
    fillName("my-agent");
    fillDescription("A very useful agent for team work");
    fireEvent.click(screen.getByRole("button", { name: /create agent/i }));
    expect(onSuccess).toHaveBeenCalledWith("my-agent");
  });

  it("uses standalone fallback (useStartJob) when no onDispatch prop is provided", () => {
    renderWizard();
    fillName("standalone-agent");
    fillDescription("A very useful standalone agent");
    fireEvent.click(screen.getByRole("button", { name: /create agent/i }));
    expect(mockMutate).toHaveBeenCalledWith(
      expect.objectContaining({ command: "agent.init", name: "standalone-agent" }),
      expect.any(Object),
    );
    expect(onDispatch).not.toHaveBeenCalled();
  });

  it("includes template slug in request when a template card is selected", () => {
    renderWizardWithCallbacks();
    fillName("good-name");
    fillDescription("A helpful agent for tutoring");
    fireEvent.click(screen.getByText(/incident debugger/i).closest("button")!);
    fireEvent.click(screen.getByRole("button", { name: /create agent/i }));
    expect(onDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ command: "agent.init", template: "incident-debugger" }),
    );
  });

  it("does NOT include template when empty-agent card is selected", () => {
    renderWizardWithCallbacks();
    fillName("good-name");
    fillDescription("A helpful agent for tutoring");
    fireEvent.click(screen.getByText(/empty agent.*advanced/i).closest("button")!);
    fireEvent.click(screen.getByRole("button", { name: /create agent/i }));
    const req = onDispatch.mock.calls[0]?.[0];
    expect(req).not.toHaveProperty("template");
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
});
