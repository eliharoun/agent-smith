import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Platform } from "gui-shared";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ReconfigureModal } from "./ReconfigureModal";

const server = setupServer(
  http.get("*/api/agents/alpha/refresh-manifest", () =>
    HttpResponse.json({ agent: "alpha", platforms: ["opencode"] }),
  ),
  http.get("*/api/agents/installed-statuses", () =>
    HttpResponse.json({
      alpha: {
        agent: "alpha",
        installed: { opencode: true, "claude-code": true, codex: true },
      },
    }),
  ),
  http.post("*/api/jobs", () => HttpResponse.json({ jobId: "j1", argv: [], preview: "" })),
);

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

beforeEach(() => {
  sessionStorage.setItem("smith.gui.token", "t");
});

const ALL_TARGETS: Platform[] = ["opencode", "claude-code", "codex", "kiro"];

function renderModal(opts: { onClose?: () => void; targets?: Platform[] } = {}) {
  const onClose = opts.onClose ?? (() => {});
  const targets = opts.targets ?? ALL_TARGETS;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ReconfigureModal agent="alpha" targets={targets} onClose={onClose} />
    </QueryClientProvider>,
  );
}

describe("ReconfigureModal", () => {
  it("loads current refresh-consent state and pre-checks granted platforms", async () => {
    renderModal();
    await waitFor(() => screen.getByLabelText(/opencode/i));
    const opencode = screen.getByLabelText(/opencode/i) as HTMLInputElement;
    const claude = screen.getByLabelText(/claude-code/i) as HTMLInputElement;
    const codex = screen.getByLabelText(/codex/i) as HTMLInputElement;
    expect(opencode.checked).toBe(true); // currently granted
    expect(claude.checked).toBe(false); // declared target, not yet granted
    expect(codex.checked).toBe(false); // declared target, not yet granted
    // All installed → all enabled.
    await waitFor(() => expect(opencode.disabled).toBe(false));
    expect(claude.disabled).toBe(false);
    expect(codex.disabled).toBe(false);
  });

  it("disables checkbox for platform where agent is not installed and no stale grant", async () => {
    server.use(
      http.get("*/api/agents/installed-statuses", () =>
        HttpResponse.json({
          alpha: {
            agent: "alpha",
            installed: { opencode: true, "claude-code": false, codex: false },
          },
        }),
      ),
    );
    renderModal();
    await waitFor(() => screen.getByLabelText(/opencode/i));
    const opencode = screen.getByLabelText(/opencode/i) as HTMLInputElement;
    const claude = screen.getByLabelText(/claude-code/i) as HTMLInputElement;
    const codex = screen.getByLabelText(/codex/i) as HTMLInputElement;
    // opencode: installed → enabled.
    await waitFor(() => expect(opencode.disabled).toBe(false));
    // claude-code, codex: not installed, not currently granted → disabled.
    expect(claude.disabled).toBe(true);
    expect(codex.disabled).toBe(true);
  });

  it("keeps checkbox enabled for stale grant on uninstalled platform (revoke path)", async () => {
    // opencode not installed, but manifest still says granted → user must be
    // able to revoke the stale grant from the GUI.
    server.use(
      http.get("*/api/agents/installed-statuses", () =>
        HttpResponse.json({
          alpha: {
            agent: "alpha",
            installed: { opencode: false, "claude-code": true, codex: false },
          },
        }),
      ),
    );
    renderModal();
    await waitFor(() => screen.getByLabelText(/opencode/i));
    const opencode = screen.getByLabelText(/opencode/i) as HTMLInputElement;
    const claude = screen.getByLabelText(/claude-code/i) as HTMLInputElement;
    const codex = screen.getByLabelText(/codex/i) as HTMLInputElement;
    // opencode: not installed but currently granted → enabled (revoke-only).
    await waitFor(() => expect(opencode.disabled).toBe(false));
    // claude-code: installed → enabled.
    expect(claude.disabled).toBe(false);
    // codex: neither installed nor granted → disabled.
    expect(codex.disabled).toBe(true);
  });

  it("renders only platforms listed in targets prop", async () => {
    renderModal({ targets: ["opencode"] });
    await waitFor(() => screen.getByLabelText(/opencode/i));
    expect(screen.queryByLabelText(/claude-code/i)).toBeNull();
    expect(screen.queryByLabelText(/codex/i)).toBeNull();
  });

  it("Save with toggle on claude-code dispatches grant=['claude-code']", async () => {
    const postSpy = vi.fn();
    server.use(
      http.post("*/api/jobs", async ({ request }) => {
        postSpy(await request.json());
        return HttpResponse.json({ jobId: "j2", argv: [], preview: "" });
      }),
    );
    renderModal();
    await waitFor(() => screen.getByLabelText(/claude-code/i));
    fireEvent.click(screen.getByLabelText(/claude-code/i));
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(postSpy).toHaveBeenCalled());
    expect(postSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "agent.reconfigure",
        name: "alpha",
        grant: ["claude-code"],
        revoke: [],
      }),
    );
  });

  it("Save with toggle off opencode dispatches revoke=['opencode']", async () => {
    const postSpy = vi.fn();
    server.use(
      http.post("*/api/jobs", async ({ request }) => {
        postSpy(await request.json());
        return HttpResponse.json({ jobId: "j2", argv: [], preview: "" });
      }),
    );
    renderModal();
    await waitFor(() => screen.getByLabelText(/opencode/i));
    fireEvent.click(screen.getByLabelText(/opencode/i));
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(postSpy).toHaveBeenCalled());
    expect(postSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "agent.reconfigure",
        name: "alpha",
        grant: [],
        revoke: ["opencode"],
      }),
    );
  });

  it("Save with no changes does NOT dispatch a job", async () => {
    const postSpy = vi.fn();
    server.use(
      http.post("*/api/jobs", async ({ request }) => {
        postSpy(await request.json());
        return HttpResponse.json({ jobId: "j2", argv: [], preview: "" });
      }),
    );
    const onClose = vi.fn();
    renderModal({ onClose });
    await waitFor(() => screen.getByLabelText(/opencode/i));
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    // Modal should close without dispatching
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(postSpy).not.toHaveBeenCalled();
  });

  it("Cancel button closes without dispatching", async () => {
    const postSpy = vi.fn();
    server.use(
      http.post("*/api/jobs", async () => {
        postSpy();
        return HttpResponse.json({ jobId: "j", argv: [], preview: "" });
      }),
    );
    const onClose = vi.fn();
    renderModal({ onClose });
    await waitFor(() => screen.getByLabelText(/opencode/i));
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onClose).toHaveBeenCalled();
    expect(postSpy).not.toHaveBeenCalled();
  });

  it("keeps modal open and shows inline error when dispatch fails", async () => {
    server.use(
      http.post("*/api/jobs", () =>
        HttpResponse.json({ code: "BOOM", error: "thing exploded" }, { status: 500 }),
      ),
    );
    const onClose = vi.fn();
    renderModal({ onClose });
    await waitFor(() => screen.getByLabelText(/claude-code/i));
    fireEvent.click(screen.getByLabelText(/claude-code/i));
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await screen.findByText(/error.*thing exploded/i);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("renders an empty-state message when targets is empty and disables Save", async () => {
    renderModal({ targets: [] });
    await waitFor(() => screen.getByText(/declares no platform targets/i));
    expect(screen.queryByLabelText(/opencode/i)).toBeNull();
    const save = screen.getByRole("button", { name: /save/i }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
  });
});
