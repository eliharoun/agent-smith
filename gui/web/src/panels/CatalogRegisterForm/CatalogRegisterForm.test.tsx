import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CatalogRegisterForm } from "./CatalogRegisterForm";

type Call = { url: string; init?: RequestInit | undefined };
function mockFetch(handler: (url: string, init?: RequestInit) => Response, calls: Call[]) {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({ url, init });
    return handler(url, init);
  };
}

function renderForm(initialRegistry: "agent" | "skill" = "agent") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/catalogs/register?registry=${initialRegistry}`]}>
        <CatalogRegisterForm initialRegistry={initialRegistry} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Advance fake timers past debounce, then restore real timers so waitFor works. */
async function advanceDebounce(ms = 500) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
  vi.useRealTimers();
}

describe("CatalogRegisterForm", () => {
  let calls: Call[];
  beforeEach(() => {
    calls = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── radio-button UX ──────────────────────────────────────────────────────

  it("renders plain-English radio buttons, not a select#f-kind", () => {
    renderForm("agent");
    expect(document.getElementById("f-kind")).toBeNull();
    expect(screen.getByRole("radio", { name: /for me/i })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /for this project/i })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /shared with team/i })).toBeInTheDocument();
  });

  it("shows subtitle only for the selected radio option", () => {
    renderForm("agent");
    // Default selected is "user-global" / "For me" — its subtitle visible
    const forMeRadio = screen.getByRole("radio", { name: /for me/i });
    expect(forMeRadio).toBeChecked();
    // The subtitle for "For me" (agent) is visible
    expect(screen.getByText(/install just for you/i)).toBeInTheDocument();

    // Click "For this project" — its subtitle should now appear
    fireEvent.click(screen.getByRole("radio", { name: /for this project/i }));
    expect(screen.getByText(/install into the current project/i)).toBeInTheDocument();
  });

  it("defaults kind based on registry and switches kinds when registry flips", () => {
    renderForm("agent");
    // Agent radio buttons present
    expect(screen.getByRole("radio", { name: /for me/i })).toBeChecked();
    expect(screen.getByRole("radio", { name: /for this project/i })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /shared with team/i })).toBeInTheDocument();

    // Flip to Skill.
    fireEvent.click(screen.getByRole("button", { name: /^Skill$/ }));
    // Skill radio buttons still present (same labels, different underlying values)
    expect(screen.getByRole("radio", { name: /for me/i })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /for this project/i })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /shared with team/i })).toBeInTheDocument();
  });

  // ── advanced disclosure ──────────────────────────────────────────────────

  it("advanced <details> is collapsed by default", () => {
    renderForm("agent");
    const details = document.querySelector("details");
    expect(details).not.toBeNull();
    expect((details as HTMLDetailsElement).open).toBe(false);
  });

  it("allow-empty and skip-git-check toggles are inside the <details>", () => {
    renderForm("agent");
    const details = document.querySelector("details")!;
    expect(details.innerHTML).toMatch(/skip git check/i);
    expect(details.innerHTML).toMatch(/allow empty/i);
  });

  // ── auto-verify (debounced, no manual Verify button) ────────────────────

  it("does NOT render a manual Verify button", () => {
    renderForm("agent");
    expect(screen.queryByRole("button", { name: /^Verify$/i })).toBeNull();
  });

  it("auto-verify fires after debounce delay when path is typed", async () => {
    vi.useFakeTimers();
    globalThis.fetch = mockFetch((url) => {
      if (url.includes("/api/git/verify-remote")) {
        return new Response(
          JSON.stringify({
            ok: true,
            skipped: false,
            remotes: [{ name: "origin", url: "git@github.com:a/b.git" }],
          }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 200 });
    }, calls) as unknown as typeof fetch;

    renderForm("agent");
    fireEvent.change(screen.getByLabelText(/^\/\/ path/i), { target: { value: "/tmp/foo" } });

    // Before debounce: no verify call yet
    expect(calls.filter((c) => c.url.includes("/api/git/verify-remote"))).toHaveLength(0);

    // Advance past the 400ms debounce, then restore real timers for waitFor
    await advanceDebounce(500);

    await waitFor(() =>
      expect(calls.filter((c) => c.url.includes("/api/git/verify-remote"))).toHaveLength(1),
    );
    await waitFor(() => expect(screen.getByText(/verified/i)).toBeInTheDocument());
  });

  it("auto-verify does NOT fire before the debounce delay", async () => {
    vi.useFakeTimers();
    globalThis.fetch = mockFetch((url) => {
      if (url.includes("/api/git/verify-remote")) {
        return new Response(JSON.stringify({ ok: true, skipped: false, remotes: [] }), {
          status: 200,
        });
      }
      return new Response("{}", { status: 200 });
    }, calls) as unknown as typeof fetch;

    renderForm("agent");
    fireEvent.change(screen.getByLabelText(/^\/\/ path/i), { target: { value: "/tmp/foo" } });

    // Advance only 200ms — still within the 400ms debounce window
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

    expect(calls.filter((c) => c.url.includes("/api/git/verify-remote"))).toHaveLength(0);
    vi.useRealTimers();
  });

  // ── explainer paragraph ──────────────────────────────────────────────────

  it("shows an explainer paragraph about catalogs", () => {
    renderForm("agent");
    expect(screen.getByText(/a catalog is a folder or git repo/i)).toBeInTheDocument();
  });

  // ── standalone fallback (propless render) ───────────────────────────────

  it("renders without throwing when no props are passed (standalone fallback)", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    expect(() =>
      render(
        <QueryClientProvider client={qc}>
          <MemoryRouter>
            <CatalogRegisterForm />
          </MemoryRouter>
        </QueryClientProvider>,
      ),
    ).not.toThrow();
    expect(screen.getByRole("button", { name: /^Register$/ })).toBeInTheDocument();
  });

  // ── existing behavior preserved ──────────────────────────────────────────

  it("Register button is disabled until verify ok OR skipGitCheck is on", async () => {
    vi.useFakeTimers();
    globalThis.fetch = mockFetch(
      () => new Response("{}", { status: 200 }),
      calls,
    ) as unknown as typeof fetch;
    renderForm("agent");
    fireEvent.change(screen.getByLabelText(/^\/\/ path/i), { target: { value: "/tmp/foo" } });
    const register = screen.getByRole("button", { name: /^Register$/ });
    expect(register.hasAttribute("disabled")).toBe(true);

    // Toggle skip-git-check on — it lives inside <details>, open it first
    const details = document.querySelector("details")!;
    fireEvent.click(details.querySelector("summary")!);

    // Match the toggle, not the FieldHelp icon (whose label is `help: skip git check`).
    fireEvent.click(screen.getByLabelText(/^skip git check$/i));
    vi.useRealTimers();
    await waitFor(() => expect(register.hasAttribute("disabled")).toBe(false));
  });

  it("auto-verify success renders 'verified' chip; register dispatches agent.register", async () => {
    vi.useFakeTimers();
    globalThis.fetch = mockFetch((url) => {
      if (url.includes("/api/git/verify-remote")) {
        return new Response(
          JSON.stringify({
            ok: true,
            skipped: false,
            remotes: [{ name: "origin", url: "git@github.com:a/b.git" }],
          }),
          { status: 200 },
        );
      }
      if (url.includes("/api/jobs")) {
        return new Response(JSON.stringify({ jobId: "j1" }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }, calls) as unknown as typeof fetch;

    renderForm("agent");
    fireEvent.change(screen.getByLabelText(/^\/\/ path/i), { target: { value: "/tmp/foo" } });
    fireEvent.change(screen.getByLabelText(/^\/\/ label/i), { target: { value: "my-agents" } });

    // Advance past debounce to trigger auto-verify, then restore real timers
    await advanceDebounce(500);

    await waitFor(() => expect(screen.getByText(/verified/i)).toBeInTheDocument());

    const register = screen.getByRole("button", { name: /^Register$/ });
    await waitFor(() => expect(register.hasAttribute("disabled")).toBe(false));
    fireEvent.click(register);
    await waitFor(() => {
      const post = calls.find((c) => c.url.includes("/api/jobs") && c.init?.method === "POST");
      expect(post).toBeDefined();
      const body = JSON.parse((post!.init!.body as string) ?? "{}");
      expect(body.command).toBe("agent.register");
      expect(body.path).toBe("/tmp/foo");
      expect(body.kind).toBe("user-global");
      expect(body.label).toBe("my-agents");
    });
  });

  it("auto-verify not-a-git-repo renders amber chip; switching registry dispatches skill.register", async () => {
    vi.useFakeTimers();
    globalThis.fetch = mockFetch((url) => {
      if (url.includes("/api/git/verify-remote")) {
        return new Response(JSON.stringify({ ok: false, reason: "not-a-git-repo" }), {
          status: 200,
        });
      }
      if (url.includes("/api/jobs")) {
        return new Response(JSON.stringify({ jobId: "j1" }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }, calls) as unknown as typeof fetch;

    renderForm("skill");
    fireEvent.change(screen.getByLabelText(/^\/\/ path/i), { target: { value: "/tmp/bar" } });

    // Advance past debounce to trigger auto-verify, then restore real timers
    await advanceDebounce(500);

    await waitFor(() => expect(screen.getByText(/not a git repo/i)).toBeInTheDocument());

    // Register disabled because verify failed and skip-git-check off.
    const register = screen.getByRole("button", { name: /^Register$/ });
    expect(register.hasAttribute("disabled")).toBe(true);

    // Open advanced section to toggle skip-git-check.
    const details = document.querySelector("details")!;
    fireEvent.click(details.querySelector("summary")!);

    // Match the toggle, not the FieldHelp icon (whose label is `help: skip git check`).
    fireEvent.click(screen.getByLabelText(/^skip git check$/i));
    await waitFor(() => expect(register.hasAttribute("disabled")).toBe(false));
    fireEvent.click(register);
    await waitFor(() => {
      const post = calls.find((c) => c.url.includes("/api/jobs") && c.init?.method === "POST");
      expect(post).toBeDefined();
      const body = JSON.parse((post!.init!.body as string) ?? "{}");
      expect(body.command).toBe("skill.register");
      expect(body.skipGitCheck).toBe(true);
    });
  });

  it("auto-verify remote-mismatch renders red chip with detected remotes", async () => {
    vi.useFakeTimers();
    globalThis.fetch = mockFetch((url) => {
      if (url.includes("/api/git/verify-remote")) {
        return new Response(
          JSON.stringify({
            ok: false,
            reason: "remote-mismatch",
            found: [{ name: "origin", url: "git@github.com:other/repo.git" }],
          }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 200 });
    }, calls) as unknown as typeof fetch;

    renderForm("agent");
    fireEvent.change(screen.getByLabelText(/^\/\/ path/i), { target: { value: "/tmp/foo" } });
    fireEvent.change(screen.getByLabelText(/^\/\/ git remote/i), {
      target: { value: "https://github.com/a/b" },
    });

    // Advance past debounce to trigger auto-verify, then restore real timers
    await advanceDebounce(500);

    await waitFor(() => expect(screen.getByText(/remote mismatch/i)).toBeInTheDocument());
    expect(screen.getByText(/other\/repo/)).toBeInTheDocument();
  });

  // ── onDispatch / onClose prop variants ──────────────────────────────────

  it("calls onDispatch and onClose when provided, instead of navigating", async () => {
    vi.useFakeTimers();
    const onDispatch = vi.fn();
    const onClose = vi.fn();
    globalThis.fetch = mockFetch((url) => {
      if (url.includes("/api/git/verify-remote")) {
        return new Response(
          JSON.stringify({ ok: true, skipped: false, remotes: [] }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 200 });
    }, calls) as unknown as typeof fetch;

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <CatalogRegisterForm onDispatch={onDispatch} onClose={onClose} />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    fireEvent.change(screen.getByLabelText(/^\/\/ path/i), { target: { value: "/tmp/dispatch" } });

    // Advance past debounce to trigger auto-verify, then restore real timers
    await advanceDebounce(500);

    await waitFor(() => expect(screen.getByText(/verified/i)).toBeInTheDocument());

    const register = screen.getByRole("button", { name: /^Register$/ });
    await waitFor(() => expect(register.hasAttribute("disabled")).toBe(false));
    fireEvent.click(register);

    await waitFor(() => {
      expect(onDispatch).toHaveBeenCalledOnce();
      const firstCall = onDispatch.mock.calls[0];
      expect(firstCall?.[0]).toMatchObject({
        command: "agent.register",
        path: "/tmp/dispatch",
      });
      expect(onClose).toHaveBeenCalledOnce();
    });
  });
});
