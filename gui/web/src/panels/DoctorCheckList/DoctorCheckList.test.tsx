import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { DoctorCheckList } from "./DoctorCheckList";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function renderList() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DoctorCheckList />
    </QueryClientProvider>,
  );
}

describe("DoctorCheckList", () => {
  it("renders one entry per check from a real-shape report", async () => {
    server.use(
      http.get("*/api/doctor", () =>
        HttpResponse.json({
          generatedAt: "2026-05-20T10:00:00Z",
          platforms: [
            {
              platform: "opencode",
              status: "fresh",
              vendoredDate: "x",
              sourceUrl: "x",
              liveSchemaId: null,
              liveVersion: null,
            },
          ],
          skippedPlatforms: [],
          atlassianAuth: { status: "configured", source: "env-smith" },
          exitCode: 0,
        }),
      ),
    );
    renderList();
    await screen.findByText(/OpenCode schema/i);
    expect(screen.getByText(/Atlassian credentials/i)).toBeInTheDocument();
  });

  it("renders refusal state for no-platform-detected", async () => {
    server.use(
      http.get("*/api/doctor", () =>
        HttpResponse.json({
          error: "no-platform-detected",
          message: "Install one of: OpenCode, Claude Code, Codex",
          exitCode: 2,
        }),
      ),
    );
    renderList();
    await screen.findByText(/no.*platform.*detected/i);
  });
});
