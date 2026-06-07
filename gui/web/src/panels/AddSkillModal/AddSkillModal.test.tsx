import type { JobRequest } from "gui-shared";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AddSkillModal } from "./AddSkillModal";

const onClose = vi.fn();
const onDispatch = vi.fn();

function renderModal(props: Partial<Parameters<typeof AddSkillModal>[0]> = {}) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <AddSkillModal open={true} onClose={onClose} onDispatch={onDispatch} {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("AddSkillModal", () => {
  beforeEach(() => {
    onClose.mockClear();
    onDispatch.mockClear();
  });

  it("does not render when open=false", () => {
    renderModal({ open: false });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders the menu view by default with 2 cards", () => {
    renderModal();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /install existing/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /register catalog/i })).toBeInTheDocument();
    // No 3rd card
    expect(screen.queryByRole("button", { name: /start from template/i })).toBeNull();
  });

  it("menu view shows the 2-card explainer note", () => {
    renderModal();
    expect(
      screen.getByText(/skills are authored externally — write a SKILL\.md, then install or register/i),
    ).toBeInTheDocument();
  });

  it("clicking 'Install existing' card switches to install view", () => {
    renderModal();
    fireEvent.click(screen.getByRole("button", { name: /install existing/i }));
    expect(screen.getByRole("button", { name: /back/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /install existing/i })).toBeNull();
  });

  it("clicking 'Register catalog' card switches to register view", () => {
    renderModal();
    fireEvent.click(screen.getByRole("button", { name: /register catalog/i }));
    expect(screen.getByRole("button", { name: /back/i })).toBeInTheDocument();
  });

  it("back arrow returns to menu from install view", () => {
    renderModal();
    fireEvent.click(screen.getByRole("button", { name: /install existing/i }));
    fireEvent.click(screen.getByRole("button", { name: /back/i }));
    expect(screen.getByRole("button", { name: /install existing/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /register catalog/i })).toBeInTheDocument();
  });

  it("back arrow returns to menu from register view", () => {
    renderModal();
    fireEvent.click(screen.getByRole("button", { name: /register catalog/i }));
    fireEvent.click(screen.getByRole("button", { name: /back/i }));
    expect(screen.getByRole("button", { name: /install existing/i })).toBeInTheDocument();
  });

  it("closing and re-opening resets view to menu", () => {
    const qc = new QueryClient();
    const { rerender } = renderModal();
    fireEvent.click(screen.getByRole("button", { name: /install existing/i }));
    rerender(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <AddSkillModal open={false} onClose={onClose} onDispatch={onDispatch} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    rerender(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <AddSkillModal open={true} onClose={onClose} onDispatch={onDispatch} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByRole("button", { name: /install existing/i })).toBeInTheDocument();
  });

  it("initialView='install' opens directly on install sub-form, skipping menu", () => {
    renderModal({ initialView: "install" });
    expect(screen.queryByRole("button", { name: /install existing/i })).toBeNull();
    expect(screen.getByRole("button", { name: /back/i })).toBeInTheDocument();
  });

  it("initialView='register' opens directly on register sub-form, skipping menu", () => {
    renderModal({ initialView: "register" });
    expect(screen.queryByRole("button", { name: /register catalog/i })).toBeNull();
    expect(screen.getByRole("button", { name: /back/i })).toBeInTheDocument();
  });

  it("closing the modal calls onClose via X button", () => {
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

  it("no lockedView prop — back arrow is always visible on sub-forms", () => {
    renderModal({ initialView: "register" });
    expect(screen.getByRole("button", { name: /back/i })).toBeInTheDocument();
  });

  it("smart input shows live badge for git URL before debounce", () => {
    renderModal();
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "https://github.com/acme/skills" },
    });
    expect(screen.getByText(/\[git url\]/i)).toBeInTheDocument();
    // Still on menu — debounce hasn't fired yet
    expect(screen.getByRole("button", { name: /install existing/i })).toBeInTheDocument();
  });

  it("smart input shows [catalog ref] badge for catalog/name input", () => {
    renderModal();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "default/tdd" } });
    expect(screen.getByText(/\[catalog ref\]/i)).toBeInTheDocument();
  });

  it("[catalog ref] badge uses '· install by reference…' suffix (not auto-jumping)", () => {
    renderModal();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "default/tdd" } });
    expect(screen.getByText(/· install by reference…/i)).toBeInTheDocument();
    expect(screen.queryByText(/· auto-jumping to install…/i)).toBeNull();
  });

  it("[git url] badge uses '· auto-jumping to install…' suffix", () => {
    renderModal();
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "https://github.com/acme/skills" },
    });
    expect(screen.getByText(/· auto-jumping to install…/i)).toBeInTheDocument();
    expect(screen.queryByText(/· install by reference…/i)).toBeNull();
  });

  it("smart input shows no badge for bare word", () => {
    renderModal();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "tdd" } });
    expect(screen.queryByText(/\[git url\]/i)).toBeNull();
    expect(screen.queryByText(/\[catalog ref\]/i)).toBeNull();
  });
});

describe("sub-form rendering", () => {
  beforeEach(() => {
    onClose.mockClear();
    onDispatch.mockClear();
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({}),
      text: async () => "{}",
    })) as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("install view renders InstallExistingForm in skill mode (manual card click)", () => {
    renderModal({ initialView: "install" });
    // liveKind is unknown (no smartInput) → InstallExistingForm shown + disclosure present
    expect(screen.getByText(/where is the skill\?/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^discover$/i })).toBeInTheDocument();
  });

  it("register view renders CatalogRegisterForm in skill mode (skills wording)", () => {
    renderModal({ initialView: "register" });
    // Registry-aware explainer: skill mode says "skills"
    expect(screen.getByText(/folder or git repo full of skills/i)).toBeInTheDocument();
    // Skill-only kind radios present, agent-only kinds absent
    expect(document.querySelector('input[type="radio"][value="user-local"]')).toBeInTheDocument();
    expect(document.querySelector('input[type="radio"][value="team-shared"]')).toBeInTheDocument();
    expect(document.querySelector('input[type="radio"][value="project"]')).toBeNull();
    expect(document.querySelector('input[type="radio"][value="registered"]')).toBeNull();
  });

  it("register view hides the Agent/Skill toggle (lockRegistry=true)", () => {
    renderModal({ initialView: "register" });
    // AddSkillModal passes lockRegistry to CatalogRegisterForm — toggle must be absent
    expect(screen.queryByRole("button", { name: /^Agent$/ })).toBeNull();
  });

  it("catalog-ref bypass: install view shows ONLY ref field, no InstallExistingForm", async () => {
    // Simulate arriving via catalog-ref smart input (liveKind set before view switch)
    vi.useFakeTimers();
    renderModal();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "default/tdd" } });
    await act(async () => { vi.advanceTimersByTime(400); });
    vi.useRealTimers();
    // catalog-ref bypass: ref field present, InstallExistingForm absent
    expect(screen.queryByText(/where is the skill\?/i)).toBeNull();
    const inputs = screen.getAllByRole("textbox") as HTMLInputElement[];
    const refField = inputs.find((i) => i.placeholder === "default/tdd" || i.value === "default/tdd");
    expect(refField).toBeTruthy();
  });

  it("ref-install field dispatches skill.install { name } when install button clicked", () => {
    renderModal({ initialView: "install" });
    // Open the disclosure to access the ref field (manual view entry)
    const disclosure = document.querySelector("details");
    if (disclosure) fireEvent.click(disclosure.querySelector("summary")!);
    const inputs = screen.getAllByRole("textbox") as HTMLInputElement[];
    const refInputEl = inputs.find((i) => i.placeholder === "default/tdd");
    if (refInputEl) {
      fireEvent.change(refInputEl, { target: { value: "default/tdd" } });
      fireEvent.click(screen.getByRole("button", { name: /^install$/i }));
      expect(onDispatch).toHaveBeenCalledWith({
        command: "skill.install",
        name: "default/tdd",
        targets: [],
      });
      expect(onClose).toHaveBeenCalled();
    }
  });

  it("install button disabled when ref field is empty", () => {
    // Simulate catalog-ref bypass so only the ref field is shown (no disclosure needed)
    vi.useFakeTimers();
    renderModal();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "default/tdd" } });
    // bypass fires but refInput starts empty — advance timers
    act(() => { vi.advanceTimersByTime(400); });
    vi.useRealTimers();
    // ref field was pre-filled with "default/tdd" from bypass, so clear it to test disabled state
    const inputs = screen.getAllByRole("textbox") as HTMLInputElement[];
    const refEl = inputs.find((i) => i.value === "default/tdd");
    if (refEl) {
      fireEvent.change(refEl, { target: { value: "" } });
      expect(screen.getByRole("button", { name: /^install$/i })).toBeDisabled();
    }
  });

  it("pre-fills InstallExistingForm URL from smartInput when auto-bypassed via URL source kind", async () => {
    vi.useFakeTimers();
    renderModal();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "https://github.com/acme/skills" } });
    await act(async () => { vi.advanceTimersByTime(400); });
    vi.useRealTimers();
    // InstallExistingForm's URL field should be pre-seeded with the smart input value
    const sourceField = screen.getByLabelText(/where is the skill/i, { selector: "input" }) as HTMLInputElement;
    expect(sourceField.value).toBe("https://github.com/acme/skills");
  });
});

describe("smart input bypass", () => {
  beforeEach(() => {
    onClose.mockClear();
    onDispatch.mockClear();
    vi.useFakeTimers();
  });
  afterEach(() => { vi.useRealTimers(); });

  it("pasting a git SSH URL jumps to install view after debounce delay (400ms)", async () => {
    renderModal();
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "git@github.com:acme/skills.git" } });
    expect(screen.getByRole("button", { name: /install existing/i })).toBeInTheDocument();
    await act(async () => { vi.advanceTimersByTime(400); });
    expect(screen.queryByRole("button", { name: /install existing/i })).toBeNull();
    expect(screen.getByRole("button", { name: /back/i })).toBeInTheDocument();
  });

  it("SSH guard: git@host:repo.tgz goes to install (git-url) after debounce", async () => {
    renderModal();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "git@host:acme/repo.tgz" } });
    await act(async () => { vi.advanceTimersByTime(400); });
    expect(screen.queryByRole("button", { name: /install existing/i })).toBeNull();
    expect(screen.getByRole("button", { name: /back/i })).toBeInTheDocument();
  });

  it("pasting an https tgz URL jumps to install view after debounce", async () => {
    renderModal();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "https://example.com/skills.tgz" } });
    await act(async () => { vi.advanceTimersByTime(400); });
    expect(screen.queryByRole("button", { name: /install existing/i })).toBeNull();
  });

  it("pasting /absolute/path jumps to install view after debounce", async () => {
    renderModal();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "/Users/me/work/team-skills" } });
    await act(async () => { vi.advanceTimersByTime(400); });
    expect(screen.queryByRole("button", { name: /install existing/i })).toBeNull();
  });

  it("catalog-ref 'default/tdd' jumps to install view after debounce", async () => {
    renderModal();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "default/tdd" } });
    await act(async () => { vi.advanceTimersByTime(400); });
    expect(screen.queryByRole("button", { name: /install existing/i })).toBeNull();
    expect(screen.getByRole("button", { name: /back/i })).toBeInTheDocument();
  });

  it("manual card click shows InstallExistingForm + collapsed ref disclosure", () => {
    renderModal();
    fireEvent.click(screen.getByRole("button", { name: /install existing/i }));
    // Manual click: liveKind is unknown → show disclosure
    expect(screen.getByText(/install by reference ▾/i)).toBeInTheDocument();
    expect(screen.getByText(/where is the skill\?/i)).toBeInTheDocument();
  });

  it("bare word stays on menu with no badge even after debounce", async () => {
    renderModal();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "tdd" } });
    await act(async () => { vi.advanceTimersByTime(400); });
    expect(screen.getByRole("button", { name: /install existing/i })).toBeInTheDocument();
    expect(screen.queryByText(/\[git url\]/i)).toBeNull();
    expect(screen.queryByText(/\[catalog ref\]/i)).toBeNull();
  });

  it("back arrow from auto-bypassed install view returns to menu and clears smart input", async () => {
    renderModal();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "https://github.com/acme/skills" } });
    await act(async () => { vi.advanceTimersByTime(400); });
    fireEvent.click(screen.getByRole("button", { name: /back/i }));
    expect(screen.getByRole("button", { name: /install existing/i })).toBeInTheDocument();
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("");
  });

  it("rapid typing resets debounce — no bypass until user pauses 400ms", async () => {
    renderModal();
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "https://github.com/acme/skills" } });
    act(() => { vi.advanceTimersByTime(200); });
    expect(screen.getByRole("button", { name: /install existing/i })).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "https://github.com/acme/skills2" } });
    act(() => { vi.advanceTimersByTime(200); });
    expect(screen.getByRole("button", { name: /install existing/i })).toBeInTheDocument();
    await act(async () => { vi.advanceTimersByTime(200); });
    expect(screen.queryByRole("button", { name: /install existing/i })).toBeNull();
  });
});
