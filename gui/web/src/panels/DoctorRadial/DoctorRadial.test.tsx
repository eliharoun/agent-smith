import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { DoctorRadial } from "./DoctorRadial";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function renderRadial() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DoctorRadial />
    </QueryClientProvider>,
  );
}

describe("DoctorRadial", () => {
  it("shows healthy state for exitCode=0 with all-ok sections", async () => {
    server.use(
      http.get("*/api/doctor", () =>
        HttpResponse.json({
          generatedAt: "2026-05-20T10:00:00Z",
          platforms: [],
          skippedPlatforms: [],
          atlassianAuth: { status: "configured", source: "env-smith" },
          exitCode: 0,
        }),
      ),
    );
    renderRadial();
    await screen.findByText(/healthy/i);
  });

  it("shows refusal state when CLI returns no-platform-detected", async () => {
    server.use(
      http.get("*/api/doctor", () =>
        HttpResponse.json({
          error: "no-platform-detected",
          message: "Install one of: OpenCode, Claude Code, Codex",
          exitCode: 2,
        }),
      ),
    );
    renderRadial();
    await screen.findByText(/no.*platform.*detected/i);
  });

  it("shows doctor-failed UI on a 500 from the server", async () => {
    server.use(
      http.get("*/api/doctor", () =>
        HttpResponse.json({ code: "DOCTOR_PARSE", message: "boom" }, { status: 500 }),
      ),
    );
    renderRadial();
    await screen.findByText(/doctor failed/i);
    expect(screen.getByRole("button", { name: /re-run/i })).toBeInTheDocument();
  });
});
