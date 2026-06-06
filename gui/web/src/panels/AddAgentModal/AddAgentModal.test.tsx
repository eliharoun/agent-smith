import type { JobRequest } from "gui-shared";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AddAgentModal } from "./AddAgentModal";

const onClose = vi.fn();
const onDispatch = vi.fn();

function renderModal(props: Partial<Parameters<typeof AddAgentModal>[0]> = {}) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <AddAgentModal open={true} onClose={onClose} onDispatch={onDispatch} {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("AddAgentModal", () => {
  beforeEach(() => {
    onClose.mockClear();
    onDispatch.mockClear();
  });

  it("does not render when open=false", () => {
    renderModal({ open: false });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders the menu view by default", () => {
    renderModal();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/start from template/i)).toBeInTheDocument();
    expect(screen.getByText(/install existing/i)).toBeInTheDocument();
    expect(screen.getByText(/register catalog/i)).toBeInTheDocument();
  });

  it("clicking 'Start from template' card switches to template view", () => {
    renderModal();
    fireEvent.click(screen.getByRole("button", { name: /start from template/i }));
    expect(screen.getByRole("button", { name: /back/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /install existing/i })).toBeNull();
  });

  it("clicking 'Install existing' card switches to install view", () => {
    renderModal();
    fireEvent.click(screen.getByRole("button", { name: /install existing/i }));
    expect(screen.getByRole("button", { name: /back/i })).toBeInTheDocument();
  });

  it("clicking 'Register catalog' card switches to register view", () => {
    renderModal();
    fireEvent.click(screen.getByRole("button", { name: /register catalog/i }));
    expect(screen.getByRole("button", { name: /back/i })).toBeInTheDocument();
  });

  it("back arrow returns to menu from any sub-form", () => {
    renderModal();
    fireEvent.click(screen.getByRole("button", { name: /install existing/i }));
    fireEvent.click(screen.getByRole("button", { name: /back/i }));
    expect(screen.getByRole("button", { name: /start from template/i })).toBeInTheDocument();
  });

  it("closing and re-opening resets view to menu", () => {
    const qc = new QueryClient();
    const { rerender } = renderModal();
    fireEvent.click(screen.getByRole("button", { name: /install existing/i }));
    rerender(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <AddAgentModal open={false} onClose={onClose} onDispatch={onDispatch} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    rerender(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <AddAgentModal open={true} onClose={onClose} onDispatch={onDispatch} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByRole("button", { name: /start from template/i })).toBeInTheDocument();
  });

  it("initialView='register' opens directly on register sub-form, skipping menu", () => {
    renderModal({ initialView: "register" });
    expect(screen.queryByRole("button", { name: /start from template/i })).toBeNull();
    expect(screen.getByRole("button", { name: /back/i })).toBeInTheDocument();
  });

  it("closing the modal calls onClose", () => {
    renderModal();
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it("pressing Escape calls onClose", () => {
    renderModal();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("clicking the backdrop overlay calls onClose", () => {
    renderModal();
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalled();
  });

  it("clicking the inner panel does NOT call onClose", () => {
    renderModal();
    const panel = screen.getByRole("dialog").firstElementChild as HTMLElement;
    fireEvent.click(panel);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("dialog has an accessible name via aria-labelledby", () => {
    renderModal();
    const dialog = screen.getByRole("dialog");
    const labelId = dialog.getAttribute("aria-labelledby");
    expect(labelId).toBeTruthy();
    expect(document.getElementById(labelId!)).toBeInTheDocument();
  });

  it("back arrow is hidden when lockedView=true", () => {
    renderModal({ initialView: "register", lockedView: true });
    expect(screen.queryByRole("button", { name: /back/i })).toBeNull();
  });

  it("back arrow is visible when lockedView is not set", () => {
    renderModal({ initialView: "register" });
    expect(screen.getByRole("button", { name: /back/i })).toBeInTheDocument();
  });
});

describe("smart input bypass", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("pasting a git SSH URL jumps to install view after debounce delay (400ms)", async () => {
    renderModal();
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "git@github.com:acme/repo.git" } });
    expect(screen.getByRole("button", { name: /start from template/i })).toBeInTheDocument();
    await act(async () => { vi.advanceTimersByTime(400); });
    expect(screen.queryByRole("button", { name: /start from template/i })).toBeNull();
    expect(screen.getByRole("button", { name: /back/i })).toBeInTheDocument();
  });

  it("SSH guard: git@host:repo.tgz goes to install (git-url) after debounce", async () => {
    renderModal();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "git@host:acme/repo.tgz" } });
    await act(async () => { vi.advanceTimersByTime(400); });
    expect(screen.queryByRole("button", { name: /start from template/i })).toBeNull();
  });

  it("pasting an https tgz URL jumps to install view after debounce", async () => {
    renderModal();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "https://example.com/foo.tgz" } });
    await act(async () => { vi.advanceTimersByTime(400); });
    expect(screen.queryByRole("button", { name: /start from template/i })).toBeNull();
  });

  it("pasting /absolute/path jumps to install view after debounce", async () => {
    renderModal();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "/Users/me/work/team-agents" } });
    await act(async () => { vi.advanceTimersByTime(400); });
    expect(screen.queryByRole("button", { name: /start from template/i })).toBeNull();
  });

  it("pasting a bare word stays on menu with no badge even after debounce", async () => {
    renderModal();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "team-agents" } });
    await act(async () => { vi.advanceTimersByTime(400); });
    expect(screen.getByRole("button", { name: /start from template/i })).toBeInTheDocument();
    expect(screen.queryByText(/\[git url\]/i)).toBeNull();
    expect(screen.queryByText(/\[archive\]/i)).toBeNull();
    expect(screen.queryByText(/\[local directory\]/i)).toBeNull();
  });

  it("badge appears immediately (live) before debounce fires", () => {
    renderModal();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "https://github.com/acme/repo" } });
    expect(screen.getByText(/\[git url\]/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /start from template/i })).toBeInTheDocument();
  });

  it("back arrow from auto-bypassed install view returns to menu and clears smart input", async () => {
    renderModal();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "https://github.com/acme/repo" } });
    await act(async () => { vi.advanceTimersByTime(400); });
    fireEvent.click(screen.getByRole("button", { name: /back/i }));
    expect(screen.getByRole("button", { name: /start from template/i })).toBeInTheDocument();
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("");
  });

  it("rapid typing resets debounce -- no bypass until user pauses 400ms", async () => {
    renderModal();
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "https://github.com/acme/repo" } });
    act(() => { vi.advanceTimersByTime(200); });
    expect(screen.getByRole("button", { name: /start from template/i })).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "https://github.com/acme/repo2" } });
    act(() => { vi.advanceTimersByTime(200); });
    expect(screen.getByRole("button", { name: /start from template/i })).toBeInTheDocument();
    await act(async () => { vi.advanceTimersByTime(200); });
    expect(screen.queryByRole("button", { name: /start from template/i })).toBeNull();
  });
});

describe("sub-form rendering", () => {
  beforeEach(() => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({}),
      text: async () => "{}",
    })) as unknown as typeof fetch;
  });

  it("template view renders AgentCreateWizard", () => {
    renderModal({ initialView: "template" });
    expect(screen.getByText(/incident debugger/i)).toBeInTheDocument();
  });

  it("install view renders InstallExistingForm", () => {
    renderModal({ initialView: "install" });
    // InstallExistingForm's unique "where is the agent?" label and "discover" button
    expect(screen.getByText(/where is the agent\?/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^discover$/i })).toBeInTheDocument();
  });

  it("register view renders CatalogRegisterForm", () => {
    renderModal({ initialView: "register" });
    expect(screen.getByText(/folder or git repo full of agents/i)).toBeInTheDocument();
  });

  it("pre-fills InstallExistingForm URL from smartInput when auto-bypassed", async () => {
    vi.useFakeTimers();
    renderModal();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "https://github.com/acme/repo" } });
    await act(async () => { vi.advanceTimersByTime(400); });
    vi.useRealTimers();
    const sourceField = screen.getByLabelText(/where is the agent/i) as HTMLInputElement;
    expect(sourceField.value).toBe("https://github.com/acme/repo");
  });

  it("passes initialRegistry to CatalogRegisterForm (skill registry preselected)", () => {
    renderModal({ initialView: "register", initialRegistry: "skill" });
    // The kind radios are the decisive proof of which registry is active:
    // skill kinds are user-global / user-local / team-shared, while agent kinds
    // are user-global / project / registered. user-local + team-shared exist
    // ONLY for the skill registry, so their presence proves skill was preselected.
    expect(document.querySelector('input[type="radio"][value="user-local"]')).toBeInTheDocument();
    expect(document.querySelector('input[type="radio"][value="team-shared"]')).toBeInTheDocument();
    // And the agent-only kinds must be absent.
    expect(document.querySelector('input[type="radio"][value="project"]')).toBeNull();
    expect(document.querySelector('input[type="radio"][value="registered"]')).toBeNull();
  });

  it("defaults to agent registry kinds when initialRegistry is not skill", () => {
    renderModal({ initialView: "register" });
    // Agent kinds present, skill-only kinds absent — proves the passthrough
    // distinguishes the two registries rather than always showing one.
    expect(document.querySelector('input[type="radio"][value="project"]')).toBeInTheDocument();
    expect(document.querySelector('input[type="radio"][value="registered"]')).toBeInTheDocument();
    expect(document.querySelector('input[type="radio"][value="user-local"]')).toBeNull();
    expect(document.querySelector('input[type="radio"][value="team-shared"]')).toBeNull();
  });
});
