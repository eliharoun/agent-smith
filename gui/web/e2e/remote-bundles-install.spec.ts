// gui/web/e2e/remote-bundles-install.spec.ts
//
// C4.10.2: end-to-end install of an agent from a (bare local) URL via the
// GUI. Exercises the full vertical slice: button click → modal → URL
// validation → dispatch → daemon spawns the CLI → CLI clones the bare
// repo → registers the catalog → installed-statuses refetch → list row
// renders with the new agent.
//
// Auth + state setup mirrors onboarding-happy-path.spec.ts: the test
// uses a deterministic dev token via SMITH_GUI_DEV_TOKEN and seeds
// $XDG_CONFIG_HOME/agent-smith/USER.md so the OnboardingGate doesn't
// redirect /agents → /onboarding. We seed in `test.beforeAll` rather
// than relying on the alphabetical ordering of other specs leaving
// state behind — that coupling was previously implicit and brittle.

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { withBareRemote } from "./fixtures/bare-remote";

test.use({ extraHTTPHeaders: { authorization: "Bearer e2e-token" } });

// Match playwright.config.ts: XDG_CONFIG_HOME=<cwd>/.e2e-config.
// process.cwd() during Playwright is gui/web.
const E2E_CONFIG_HOME = join(process.cwd(), ".e2e-config");
const SMITH_HOME = join(E2E_CONFIG_HOME, "agent-smith");

test.beforeAll(async () => {
  // Bypass OnboardingGate's redirect triggers:
  //   1. FIRST_RUN / NEEDS_USER_MD — seed USER.md (>= 40 chars).
  //   2. tourCompleted:false — seed gui-state.json with tourCompleted:true.
  // ZERO_AGENTS is NOT a redirect trigger, so the gate falls through and
  // /agents renders even with an empty registry.
  await mkdir(SMITH_HOME, { recursive: true });
  await writeFile(
    join(SMITH_HOME, "USER.md"),
    "// e2e onboarding-bypass seed\n\nThis user is here to install an agent.\n",
    "utf8",
  );
  await writeFile(
    join(SMITH_HOME, "gui-state.json"),
    JSON.stringify({
      schemaVersion: 1,
      tourCompleted: true,
      lastSeenVersion: "0.25.0",
      mode: "guided",
      theme: { intensity: "medium" },
      port: 7777,
    }),
    "utf8",
  );
});

test("install agent from URL via GUI lands a new row in the list", async ({ page }, testInfo) => {
  await withBareRemote(
    testInfo,
    async ({ url }) => {
      // 1. Navigate to /agents. Token query param mirrors the onboarding
      //    spec's auth pattern; the bearer header above carries through
      //    subsequent fetch() calls but the initial document GET uses
      //    cookie/query auth.
      await page.goto("/agents?token=e2e-token");

      // 2. Open the install modal via the C4.8.2 ghost button.
      await page.getByRole("button", { name: /install from url/i }).click();

      // 3. Fill URL + ref. The bare-remote fixture's `file://` URL passes
      //    deriveRemotePathWeb's transport allowlist (file:// is an
      //    explicit local-development allow).
      // FormField renders labels with a leading `// ` prefix (Matrix
      // theme). Match the bare word with a non-anchored regex.
      await page.getByLabel(/git url/i).fill(url);
      await page.getByLabel(/\bref\b/i).fill("main");

      // 4. Click the install button inside the modal (matches by label
      //    rather than position because the modal also has a Cancel).
      await page
        .getByRole("dialog")
        .getByRole("button", { name: /^install$/i })
        .click();

      // 5. JobStreamModal opens and streams CLI stdout. The CLI exits
      //    successfully when the clone + register sequence completes.
      //    30s budget accommodates a cold git clone over file://.
      await expect(page.getByText(/\[exit 0/i)).toBeVisible({
        timeout: 30_000,
      });

      // 6. Verify the new agent shows up. The CLI derives the bundle name
      //    from `agent.config.json#name` (`e2e-agent` per the fixture).
      //    We use page.reload() rather than a goto to ensure the
      //    QueryClient cache is dropped and the agents endpoint is
      //    refetched. A bare goto to the same path is a no-op in
      //    React Router and doesn't bust the in-memory cache.
      await page.reload();
      await expect(page.getByText("e2e-agent")).toBeVisible({
        timeout: 15_000,
      });
    },
    {
      // Smith bundle layout: each agent lives in its own subdirectory
      // containing `agent.config.json` (the discriminator) plus persona
      // markdown files (IDENTITY/EXPERTISE/SOUL/USER). The CLI's install
      // validator allows USER.md to fall back to the canonical user file,
      // but the GUI server's `scanBundle` requires USER.md to exist
      // alongside the bundle. Seed all four to satisfy both readers.
      initialFiles: [
        {
          path: "e2e-agent/agent.config.json",
          contents: JSON.stringify({
            schemaVersion: 1,
            name: "e2e-agent",
            // Description must be 10-200 chars starting with an action
            // phrase per CanonicalConfigSchema.ACTION_PHRASE.
            description: "Use proactively for end-to-end install testing.",
            targets: ["opencode"],
            modelTier: "sonnet",
          }),
        },
        {
          path: "e2e-agent/IDENTITY.md",
          contents: "# Identity\n\nYou are an end-to-end test agent.\n",
        },
        {
          path: "e2e-agent/EXPERTISE.md",
          contents: "# Expertise\n\nClicking install buttons and asserting state.\n",
        },
        {
          path: "e2e-agent/SOUL.md",
          contents: "# Soul\n\nDeterministic, reproducible, never flaky (in theory).\n",
        },
        {
          path: "e2e-agent/USER.md",
          contents: "# User\n\nThe e2e test runner installing this agent.\n",
        },
      ],
    },
  );
});
