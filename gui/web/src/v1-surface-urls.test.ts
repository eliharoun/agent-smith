import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * v1-task B9: GUI web URL surface snapshot.
 *
 * This snapshot guards the set of client-side route URLs declared in
 * `App.tsx`. URLs are part of the v1 contract because users bookmark
 * them and external links into the GUI (e.g. from CLI output like
 * `smith status --gui-url`) depend on them being stable.
 *
 * IF THIS TEST FAILS, you are changing the public URL surface.
 * Your options:
 *   1. Revert the change.
 *   2. Bump the major version (v1 → v2).
 *   3. Keep the old URL live and add a redirect to the new one for at
 *      least one minor release, then retire the old URL in the next
 *      major.
 * Only after one of those three is in place should you update the
 * snapshot (`vitest -u`).
 *
 * Extraction is regex-based against the App.tsx source rather than a
 * render+probe scheme: simpler, no jsdom react-router-dom setup
 * required, and the regex catches the same drift a full render would.
 * If <Route path="..."> usage in App.tsx changes shape, update the
 * regex here rather than going to runtime extraction.
 */
describe("v1 surface — web URLs", () => {
  it("inventory of client-side routes is stable", () => {
    // Vitest under Vite transforms test files, so import.meta.url may
    // not always be a real file:// URL across runners. Anchor via
    // process.cwd() which is set to the gui/web package root by the
    // npm script: `cd gui/web && vitest run`.
    const appPath = resolve(process.cwd(), "src/App.tsx");
    const source = readFileSync(appPath, "utf8");
    // Match: <Route ... path="/anything"
    // Whitespace tolerant so the JSX formatter can wrap attrs.
    const matches = [...source.matchAll(/<Route\b[^>]*\bpath="([^"]+)"/g)];
    const urls = matches.map((m) => m[1]).sort();
    expect(urls).toMatchSnapshot();
  });
});
