import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import type { InstalledStatusBulk } from "gui-shared";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { AgentTargetsForm } from "./AgentTargetsForm";

const server = setupServer();

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function mockInstalled(name: string, installed: Record<string, boolean>) {
  const body: InstalledStatusBulk = {
    [name]: { agent: name, installed },
  };
  server.use(http.get("*/api/agents/installed-statuses", () => HttpResponse.json(body)));
}

function renderForm(targets: ("opencode" | "claude-code" | "codex")[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AgentTargetsForm
        agent={{
          name: "foo",
          description: "",
          catalog: "default",
          path: "/x",
          targets,
          model: "sonnet",
          identity: "",
          expertise: "",
          soul: "",
          user: "",
          config: {},
        }}
      />
    </QueryClientProvider>,
  );
}

describe("AgentTargetsForm", () => {
  it("renders targets and model", () => {
    mockInstalled("foo", { opencode: true, "claude-code": true });
    renderForm(["opencode", "claude-code"]);
    expect(screen.getByText("opencode")).toBeInTheDocument();
    expect(screen.getByText(/sonnet/)).toBeInTheDocument();
  });

  it("disables Reconfigure button when agent installed on no platforms", async () => {
    mockInstalled("foo", { opencode: false, "claude-code": false });
    renderForm(["opencode", "claude-code"]);
    const btn = (await screen.findByRole("button", {
      name: /reconfigure/i,
    })) as HTMLButtonElement;
    await waitFor(() => expect(btn.disabled).toBe(true));
  });

  it("enables Reconfigure when at least one declared target is installed", async () => {
    mockInstalled("foo", { opencode: true, "claude-code": false });
    renderForm(["opencode", "claude-code"]);
    const btn = (await screen.findByRole("button", {
      name: /reconfigure/i,
    })) as HTMLButtonElement;
    await waitFor(() => expect(btn.disabled).toBe(false));
  });

  it("shows visible help text when no platform is installed", async () => {
    mockInstalled("foo", { opencode: false, "claude-code": false, codex: false });
    renderForm(["opencode"]);
    expect(
      await screen.findByText(/install on at least one platform to manage refresh consent/i),
    ).toBeInTheDocument();
  });

  it("does not render the help text when at least one platform is installed", async () => {
    mockInstalled("foo", { opencode: true, "claude-code": false, codex: false });
    renderForm(["opencode"]);
    // Wait for query to resolve, then assert text absent.
    const btn = (await screen.findByRole("button", {
      name: /reconfigure/i,
    })) as HTMLButtonElement;
    await waitFor(() => expect(btn.disabled).toBe(false));
    expect(screen.queryByText(/install on at least one platform/i)).toBeNull();
  });

  it("shows a loading hint while installed statuses are pending", () => {
    // No handler registered for installed-statuses → query stays pending.
    renderForm(["opencode"]);
    expect(screen.getByText(/loading install status/i)).toBeInTheDocument();
  });
});
