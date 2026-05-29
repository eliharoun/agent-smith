import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import packageJson from "../../package.json" with { type: "json" };

/**
 * Contract test: package.json#version and the literal passed to
 * `program.version(...)` in src/index.ts must agree.
 *
 * Background: across v0.2.0–v0.4.0 the literal in src/index.ts drifted from
 * package.json (releases bumped the manifest but missed the CLI string),
 * so `smith --version` reported a stale version on shipped builds. This
 * test prevents that class of defect by failing the build whenever the
 * two sources of truth disagree.
 *
 * If you need to bump the version, change BOTH:
 *   - package.json `"version"` field
 *   - src/index.ts `program.version("...")` call
 */
describe("version sync", () => {
  test("package.json#version matches the literal in src/index.ts program.version()", async () => {
    const indexPath = join(import.meta.dir, "..", "..", "src", "index.ts");
    const indexSource = await readFile(indexPath, "utf-8");

    // Match: program....version("X.Y.Z[-suffix]") — chained or standalone.
    // Captures the version literal between double quotes.
    const match = indexSource.match(/program[\s\S]*?\.version\("([^"]+)"\)/);

    if (!match) {
      throw new Error(
        'src/index.ts must call program.version("...") with a string literal',
      );
    }

    expect(match[1]).toBe(packageJson.version);
  });
});
