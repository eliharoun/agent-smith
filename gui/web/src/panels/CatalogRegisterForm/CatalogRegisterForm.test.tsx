import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

describe("CatalogRegisterForm", () => {
  let calls: Call[];
  beforeEach(() => {
    calls = [];
  });

  it("defaults kind based on registry and switches kinds when registry flips", () => {
    renderForm("agent");
    // Agent kinds shown. The select has id=f-kind; bypass the matrix `// kind`
    // label decoration (also used by the FieldHelp aria-label) by querying
    // the element by id.
    const select = document.getElementById("f-kind") as HTMLSelectElement;
    const optionValues = Array.from(select.options).map((o) => o.value);
    expect(optionValues).toEqual(["user-global", "project", "registered"]);

    // Flip to Skill.
    fireEvent.click(screen.getByRole("button", { name: /^Skill$/ }));
    const select2 = document.getElementById("f-kind") as HTMLSelectElement;
    const opts2 = Array.from(select2.options).map((o) => o.value);
    expect(opts2).toEqual(["user-global", "user-local", "team-shared"]);
  });

  it("Register button is disabled until verify ok OR skipGitCheck is on", async () => {
    globalThis.fetch = mockFetch(
      () => new Response("{}", { status: 200 }),
      calls,
    ) as unknown as typeof fetch;
    renderForm("agent");
    fireEvent.change(screen.getByLabelText(/^\/\/ path/i), { target: { value: "/tmp/foo" } });
    const register = screen.getByRole("button", { name: /^Register$/ });
    expect(register.hasAttribute("disabled")).toBe(true);

    // Toggle skip-git-check on.
    // Match the toggle, not the FieldHelp icon (whose label is `help: skip git check`).
    fireEvent.click(screen.getByLabelText(/^skip git check$/i));
    await waitFor(() => expect(register.hasAttribute("disabled")).toBe(false));
  });

  it("verify success renders 'verified' chip; register dispatches agent.register", async () => {
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
    fireEvent.click(screen.getByRole("button", { name: /^Verify$/ }));
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

  it("verify not-a-git-repo renders amber chip; switching registry dispatches skill.register", async () => {
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
    fireEvent.click(screen.getByRole("button", { name: /^Verify$/ }));
    await waitFor(() => expect(screen.getByText(/not a git repo/i)).toBeInTheDocument());

    // Register disabled because verify failed and skip-git-check off.
    const register = screen.getByRole("button", { name: /^Register$/ });
    expect(register.hasAttribute("disabled")).toBe(true);

    // Toggle skip-git-check to allow dispatch.
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

  it("verify remote-mismatch renders red chip with detected remotes", async () => {
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
    fireEvent.click(screen.getByRole("button", { name: /^Verify$/ }));
    await waitFor(() => expect(screen.getByText(/remote mismatch/i)).toBeInTheDocument());
    expect(screen.getByText(/other\/repo/)).toBeInTheDocument();
  });
});
