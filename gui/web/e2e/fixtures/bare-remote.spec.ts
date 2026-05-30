// gui/web/e2e/fixtures/bare-remote.spec.ts
//
// Smoke test for the bare-remote Playwright fixture (C4.10.1). Verifies
// the wrapper spins up a usable file:// URL, optionally seeds an initial
// file, and exposes the headSha hook the install/sync specs depend on.
//
// Note: every `test()` callback takes `({}, testInfo)` because Playwright
// requires the first argument to be an object-destructuring pattern even
// when no built-in fixtures are consumed. Single-line biome-ignore
// directives suppress the resulting `noEmptyPattern` lint.

import { expect, test } from "@playwright/test";
import { withBareRemote } from "./bare-remote";

test.describe("bare-remote fixture (C4.10.1)", () => {
  // biome-ignore lint/correctness/noEmptyPattern: Playwright requires destructuring pattern
  test("exposes a usable file:// URL", async ({}, testInfo) => {
    await withBareRemote(testInfo, async ({ url }) => {
      expect(url).toMatch(/^file:\/\//);
    });
  });

  // biome-ignore lint/correctness/noEmptyPattern: Playwright requires destructuring pattern
  test("seeds an initial file when initialFile is provided", async ({}, testInfo) => {
    await withBareRemote(
      testInfo,
      async ({ headSha }) => {
        const sha = await headSha();
        // 40-char hex confirms the commit landed on the bare remote.
        expect(sha).toMatch(/^[0-9a-f]{40}$/);
      },
      {
        initialFile: {
          path: "agent.yaml",
          contents: "name: e2e-agent\ndescription: test\n",
        },
      },
    );
  });

  // biome-ignore lint/correctness/noEmptyPattern: Playwright requires destructuring pattern
  test("commitFile pushes additional commits during the block", async ({}, testInfo) => {
    await withBareRemote(testInfo, async ({ commitFile, headSha }) => {
      const sha1 = await commitFile("a.txt", "first");
      const sha2 = await commitFile("b.txt", "second");
      expect(sha1).not.toBe(sha2);
      // After two commits, headSha should match the second commit's sha.
      expect(await headSha()).toBe(sha2);
    });
  });
});
