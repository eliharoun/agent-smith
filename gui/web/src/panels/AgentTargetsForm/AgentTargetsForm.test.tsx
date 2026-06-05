import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AgentDetail } from "gui-shared";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentTargetsForm } from "./AgentTargetsForm";

const baseAgent: AgentDetail = {
  name: "foo",
  description: "test agent",
  catalog: "default",
  path: "/x/foo",
  model: "balanced",
  targets: ["opencode", "claude-code"],
  identity: "i",
  expertise: "e",
  soul: "s",
  user: "u",
  config: {
    name: "foo",
    description: "test agent",
    targets: ["opencode", "claude-code"],
    modelTier: "balanced",
  },
};

const server = setupServer(
  http.get("*/api/knowledge/foo", () => HttpResponse.json({ sources: [], consent: null })),
  http.get("*/api/agents/foo/refresh-manifest", () =>
    HttpResponse.json({ agent: "foo", platforms: [] }),
  ),
  http.get("*/api/agents/installed-statuses", () =>
    HttpResponse.json({
      foo: { agent: "foo", installed: { opencode: true, "claude-code": true } },
    }),
  ),
  http.get("*/api/agents/foo/drift-check", () => HttpResponse.json({ drifted: [] })),
  http.put("*/api/agents/foo/config", () => HttpResponse.json({ ok: true })),
  http.post("*/api/jobs", () => HttpResponse.json({ jobId: "j1", preview: "" })),
);

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
beforeEach(() => sessionStorage.setItem("smith.gui.token", "t"));

function renderForm(agent: AgentDetail = baseAgent) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <AgentTargetsForm agent={agent} />
    </QueryClientProvider>,
  );
}

describe("AgentTargetsForm", () => {
  it("saving an added target PUTs a config patch including the new target", async () => {
    const putSpy = vi.fn();
    server.use(
      http.put("*/api/agents/foo/config", async ({ request }) => {
        putSpy(await request.json());
        return HttpResponse.json({ ok: true });
      }),
    );
    renderForm();
    fireEvent.click(screen.getByLabelText("kiro"));
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() => expect(putSpy).toHaveBeenCalled());
    expect(putSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        targets: expect.arrayContaining(["opencode", "claude-code", "kiro"]),
      }),
    );
  });

  it("disables Save and warns when no targets are selected", async () => {
    renderForm();
    fireEvent.click(screen.getByLabelText("opencode"));
    fireEvent.click(screen.getByLabelText("claude-code"));
    expect(screen.getByRole("button", { name: /save changes/i })).toBeDisabled();
    expect(screen.getByText(/at least one target required/i)).toBeInTheDocument();
  });

  it("after saving an added target, offers to install it and dispatches agent.install", async () => {
    const postSpy = vi.fn();
    server.use(
      http.post("*/api/jobs", async ({ request }) => {
        postSpy(await request.json());
        return HttpResponse.json({ jobId: "j2", preview: "" });
      }),
    );
    renderForm();
    fireEvent.click(screen.getByLabelText("kiro"));
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
    const installBtn = await screen.findByRole("button", { name: /install on kiro now/i });
    fireEvent.click(installBtn);
    await waitFor(() => expect(postSpy).toHaveBeenCalled());
    expect(postSpy).toHaveBeenCalledWith(
      expect.objectContaining({ command: "agent.install", name: "foo", platforms: ["kiro"] }),
    );
  });

  it("explains (no toggles) when the agent has no refreshable sources", async () => {
    renderForm();
    expect(await screen.findByText(/no auto-refreshing knowledge sources/i)).toBeInTheDocument();
    expect(screen.queryByLabelText("refresh opencode")).not.toBeInTheDocument();
  });

  it("shows refresh-hook toggles when a refreshable source exists", async () => {
    server.use(
      http.get("*/api/knowledge/foo", () =>
        HttpResponse.json({ sources: [{ source: { id: "u", type: "url" } }], consent: null }),
      ),
    );
    renderForm();
    expect(await screen.findByLabelText("refresh opencode")).toBeInTheDocument();
  });

  it("shows re-install nudge after changing model tier and saving", async () => {
    renderForm();
    fireEvent.change(screen.getByLabelText("model tier"), { target: { value: "high" } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
    expect(await screen.findByText(/re-install now/i)).toBeInTheDocument();
  });

  it("shows a drift dot next to an installed platform that is out of date", async () => {
    server.use(
      http.get("*/api/agents/foo/drift-check", () =>
        HttpResponse.json({ drifted: ["claude-code"] }),
      ),
    );
    renderForm();
    expect(await screen.findByTestId("drift-dot-claude-code")).toBeInTheDocument();
    expect(screen.queryByTestId("drift-dot-opencode")).not.toBeInTheDocument();
  });

  it("does not show a drift dot for a platform that is not installed", async () => {
    server.use(
      // kiro is not in installed (opencode + claude-code only) so even if
      // the server reports it drifted (it shouldn't), the dot stays hidden.
      http.get("*/api/agents/foo/drift-check", () =>
        HttpResponse.json({ drifted: ["kiro"] }),
      ),
    );
    renderForm();
    // Wait for the data to settle so we can assert absence reliably.
    await screen.findByLabelText("kiro");
    expect(screen.queryByTestId("drift-dot-kiro")).not.toBeInTheDocument();
  });

  // Field-help adoption smoke test (Task 31). Exhaustive per-id coverage
  // lives in `gui/web/src/help/index.test.ts`; here we just confirm the
  // panel actually wires the registry (so a regression that drops the
  // <FieldHelp> import would fail this test).
  it("renders FieldHelp icons for the targets, model-tier, and refresh-hooks labels", () => {
    renderForm();
    expect(screen.getByRole("button", { name: /help.*targets/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /help.*model tier/i })).toBeInTheDocument();
  });
});
