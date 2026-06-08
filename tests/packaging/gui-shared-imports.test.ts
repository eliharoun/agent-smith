import { describe, expect, test } from "bun:test";
import { join } from "node:path";

describe("packaging constraints", () => {
  // The published server must not contain the bare `gui-shared` specifier — it is
  // a workspace alias that does not resolve in a flat npm install. All server
  // imports must be relative into ../shared/src. (The SPA under gui/web keeps the
  // bare specifier; it is resolved by Vite at build time and ships as dist.)
  // Matches both `… from "gui-shared"` and side-effect `import "gui-shared"`.
  test("no bare gui-shared imports remain under gui/server/src", async () => {
    const root = join(import.meta.dir, "..", "..");
    const glob = new Bun.Glob("gui/server/src/**/*.{ts,tsx}");
    const offenders: string[] = [];
    for await (const rel of glob.scan(root)) {
      const text = await Bun.file(join(root, rel)).text();
      if (/(?:from|import)\s+["']gui-shared["']/.test(text)) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });
});
