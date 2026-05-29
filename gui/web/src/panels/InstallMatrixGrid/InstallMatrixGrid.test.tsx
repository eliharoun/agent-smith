import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { InstallMatrixGrid } from "./InstallMatrixGrid";

const server = setupServer(
  http.get("/api/agents", () => HttpResponse.json([{ name: "alpha", targets: [], model: null }])),
  http.get("/api/agents/installed-statuses", () =>
    HttpResponse.json({
      alpha: {
        agent: "alpha",
        installed: { opencode: true, "claude-code": false, codex: false },
      },
    }),
  ),
  http.post("/api/jobs", () => HttpResponse.json({ jobId: "j1", argv: [], preview: "" })),
);

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function renderMatrix() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <InstallMatrixGrid />
    </QueryClientProvider>,
  );
}

describe("InstallMatrixGrid (refactored)", () => {
  it("checkbox initial state reflects real installed status (opencode=on, others=off)", async () => {
    renderMatrix();
    await waitFor(() => screen.getByText("alpha"));
    const opencodeToggle = screen.getByLabelText(/alpha · opencode/i);
    const claudeToggle = screen.getByLabelText(/alpha · claude-code/i);
    await waitFor(() => expect(opencodeToggle).toHaveAttribute("aria-checked", "true"));
    expect(claudeToggle).toHaveAttribute("aria-checked", "false");
  });

  it("toggling an installed platform off shows it as off (uninstall is reachable)", async () => {
    renderMatrix();
    await waitFor(() => screen.getByText("alpha"));
    const opencodeToggle = screen.getByLabelText(/alpha · opencode/i);
    await waitFor(() => expect(opencodeToggle).toHaveAttribute("aria-checked", "true"));
    fireEvent.click(opencodeToggle);
    expect(opencodeToggle).toHaveAttribute("aria-checked", "false");
  });

  it("Apply changes computes correct install/uninstall lists vs the real installed snapshot", async () => {
    const postSpy = vi.fn();
    server.use(
      http.post("/api/jobs", async ({ request }) => {
        postSpy(await request.json());
        return HttpResponse.json({ jobId: "j2", argv: [], preview: "" });
      }),
    );
    renderMatrix();
    await waitFor(() => screen.getByText("alpha"));
    const opencodeToggle = screen.getByLabelText(/alpha · opencode/i);
    await waitFor(() => expect(opencodeToggle).toHaveAttribute("aria-checked", "true"));
    // Toggle opencode OFF (was on) and codex ON (was off)
    fireEvent.click(opencodeToggle);
    fireEvent.click(screen.getByLabelText(/alpha · codex/i));
    fireEvent.click(screen.getByText(/Apply changes/i));
    // Confirm consent if RefreshConsent modal is shown
    const consentButton = await screen.findByRole("button", { name: /^install$/i });
    fireEvent.click(consentButton);
    await waitFor(() => expect(postSpy).toHaveBeenCalled());
    const calls = postSpy.mock.calls.flat();
    const installCall = calls.find((c: { command?: string }) => c.command === "agent.install");
    const uninstallCall = calls.find((c: { command?: string }) => c.command === "agent.uninstall");
    expect(installCall).toMatchObject({
      command: "agent.install",
      name: "alpha",
      platforms: ["codex"],
    });
    expect(uninstallCall).toMatchObject({
      command: "agent.uninstall",
      name: "alpha",
      platforms: ["opencode"],
    });
  });

  it("disables Apply changes while installed-statuses is loading", async () => {
    server.use(
      http.get("/api/agents/installed-statuses", async () => {
        await new Promise((r) => setTimeout(r, 100));
        return HttpResponse.json({
          alpha: {
            agent: "alpha",
            installed: { opencode: false, "claude-code": false, codex: false },
          },
        });
      }),
    );
    renderMatrix();
    await waitFor(() => screen.getByText("alpha"));
    const applyButton = screen.getByRole("button", { name: /apply changes/i });
    expect(applyButton).toBeDisabled();
    await waitFor(() => expect(applyButton).not.toBeDisabled());
  });

  it("does not reset desired toggles when agents query refetches mid-edit", async () => {
    renderMatrix();
    await waitFor(() => screen.getByText("alpha"));
    const codexToggle = screen.getByLabelText(/alpha · codex/i);
    fireEvent.click(codexToggle);
    expect(codexToggle).toHaveAttribute("aria-checked", "true");
    server.use(
      http.get("/api/agents", () =>
        HttpResponse.json([{ name: "alpha", targets: [], model: null }]),
      ),
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByLabelText(/alpha · codex/i)).toHaveAttribute("aria-checked", "true");
  });
});
