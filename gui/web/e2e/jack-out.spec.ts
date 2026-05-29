import { expect, test } from "@playwright/test";

// Reuses the same `SMITH_GUI_DEV_TOKEN=e2e-token` pattern as
// onboarding-happy-path.spec.ts. The Playwright webServer config sets that
// env so the CLI substitutes "e2e-token" as the server's expected bearer.
test.use({ extraHTTPHeaders: { authorization: "Bearer e2e-token" } });

/**
 * Happy-path E2E for the jack-out flow.
 *
 * We DO NOT actually run `smith jack-out` (that would nuke the test runner's
 * own `~/.agent-smith`). Every server interaction is mocked via
 * `page.route`: dry-run, job-create, and the SSE stream. The CLI server
 * never has a chance to spawn a real process.
 *
 * The SSE mock emits one stdout frame and then closes — exercising the
 * "disconnect-as-success" semantic: jack-out kills the GUI server
 * mid-stream, so a disconnect after any stdout means the destructive work
 * ran. The reducer transitions running → succeeded.
 */
test("jack-out happy path with MatrixRain + simulated disconnect", async ({ page }) => {
  // 0. Bypass OnboardingGate — fresh .e2e-config would otherwise redirect to
  // /onboarding (FIRST_RUN). We pretend smith is fully initialized and the
  // tour was already completed.
  await page.route("**/api/onboarding-status", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        state: "HOME",
        detectedTools: { opencode: true, claudeCode: false, codex: false },
        agentCount: 0,
      }),
    }),
  );
  await page.route("**/api/settings", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ tourCompleted: true, currentVersion: "0.0.0-e2e" }),
    }),
  );

  // 1. Dry-run preview (real schema: { rawOutput, lines[] })
  await page.route("**/api/jack-out/dry-run*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        rawOutput:
          "This will permanently remove:\n\n" +
          "    /home/u/.agent-smith\n" +
          "    /home/u/.claude/agents/example.md\n" +
          "    /home/u/.config/opencode/agents/cli-master.md\n",
        lines: [
          "    /home/u/.agent-smith",
          "    /home/u/.claude/agents/example.md",
          "    /home/u/.config/opencode/agents/cli-master.md",
        ],
      }),
    }),
  );

  // 2. Job creation — only intercept POST so any GET (e.g. health) passes through
  await page.route("**/api/jobs", (route) => {
    if (route.request().method() === "POST") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ jobId: "test-jackout-job" }),
      });
    }
    return route.continue();
  });

  // 3. SSE stream — one stdout event then closed body (simulates disconnect)
  await page.route("**/api/jobs/test-jackout-job/stream*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      headers: { "cache-control": "no-cache" },
      body: "event: stdout\ndata: rm -rf /home/u/.agent-smith\n\n",
    }),
  );

  // Navigate (token in querystring → useToken store picks it up)
  await page.goto("/system/jack-out?token=e2e-token");

  // Stage 1: warning — rawOutput rendered + "continue" enabled
  await expect(page.getByText("// jack out — full uninstall")).toBeVisible();
  await expect(page.getByText(/\/home\/u\/\.agent-smith/)).toBeVisible();
  const continueBtn = page.getByRole("button", { name: /continue/ });
  await expect(continueBtn).toBeEnabled();
  await continueBtn.click();

  // Stage 2: confirm modal — wrong phrase keeps disabled, correct phrase enables
  await expect(page.getByText(/Type the exact phrase/)).toBeVisible();
  const tokenInput = page.getByRole("textbox");
  await tokenInput.fill("jack out"); // space — wrong, CLI literal is hyphen
  await expect(page.getByRole("button", { name: "Jack Out" })).toBeDisabled();
  await tokenInput.fill("jack-out");
  await expect(page.getByRole("button", { name: "Jack Out" })).toBeEnabled();
  await page.getByRole("button", { name: "Jack Out" }).click();

  // Stage 3: running — MatrixRain canvas mounted
  await expect(page.getByTestId("matrix-rain")).toBeVisible({ timeout: 5_000 });

  // Stage 4: success — SSE delivered stdout then closed → succeeded
  await expect(page.getByText("You have left the matrix.")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/gh repo clone eliharoun\/agent-smith/)).toBeVisible();
});
