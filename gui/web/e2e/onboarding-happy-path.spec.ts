import { expect, test } from "@playwright/test";

// We can't extract the launch token from a headless webServer easily, so the test runs
// against a server launched with `SMITH_GUI_DEV_TOKEN=e2e-token`. The CLI substitutes
// that env value as the server's expectedToken (it does NOT install a second always-valid
// token in the middleware — see gui/server/src/middleware/auth.ts for the why). Task 35
// adds a CI grep guard that fails if the env name appears outside the allowed paths.

test.use({ extraHTTPHeaders: { authorization: "Bearer e2e-token" } });

// First-run onboarding happy path. Exercises:
//   - Wake step calls `smith init` (writes to $XDG_CONFIG_HOME/agent-smith or ~/.config/agent-smith)
//   - WhoAreYou form
//   - Detect Tools (with SMITH_FAKE_TOOLS=opencode)
//   - First Agent Install (skip in E2E)
//   - Final dashboard landing
//
// To run safely without polluting your real ~/.config/agent-smith, the Playwright
// webServer config must set XDG_CONFIG_HOME to a per-run tmpdir. See
// gui/web/playwright.config.ts.
test("first-run onboarding lands on dashboard", async ({ page }) => {
  await page.goto("/?token=e2e-token");
  await expect(page.getByText(/wake up/i)).toBeVisible();
  await page.getByRole("button", { name: /begin/i }).click();
  // Wait for the wake step to spawn `smith init`, then move past WhoAreYou
  await expect(page.getByText(/who are you/i)).toBeVisible({ timeout: 15_000 });
  await page.getByRole("textbox", { name: /name/i }).fill("e2e user");
  await page.getByRole("button", { name: /next/i }).click();
  // Detect tools should report opencode found via SMITH_FAKE_TOOLS
  await expect(page.getByText(/opencode/i)).toBeVisible();
  await page.getByRole("button", { name: /next/i }).click();
  // Skip first agent install in E2E (would require a populated catalog)
  await page.getByRole("button", { name: /skip/i }).click();
  await expect(page.getByText(/you're in/i)).toBeVisible();
  await page.getByRole("button", { name: /dashboard/i }).click();
  await expect(page.getByText(/dashboard/i)).toBeVisible();
});
