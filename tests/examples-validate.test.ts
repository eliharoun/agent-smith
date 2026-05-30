import { describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assembleBody } from "../src/core/assembler";
import { validate } from "../src/core/validator";
import { loadBundle } from "../src/io/bundle-loader";

/**
 * Regression guard for the bundles shipped under examples/.
 * If anyone edits an example bundle in a way that breaks the validator
 * (line-count drift, missing 'You', accidental TODO marker, schema break),
 * this test fails before the bad bundle ships. The bundles are documented
 * as installable via `smith agent init <name> --from <example>` so they
 * must remain valid.
 */

const examplesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "examples");

describe("examples/", () => {
  test("examples/ contains the three documented bundles", async () => {
    const entries = (await readdir(examplesDir, { withFileTypes: true }))
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    expect(entries).toEqual([
      "incident-debugger",
      "knowledge-demo",
      "repo-cartographer",
      "security-threat-modeler",
    ]);
  });

  // One test per bundle so a failure pinpoints which bundle drifted.
  for (const name of [
    "incident-debugger",
    "knowledge-demo",
    "repo-cartographer",
    "security-threat-modeler",
  ]) {
    test(`${name} loads and validates with zero errors`, async () => {
      const bundlePath = join(examplesDir, name);
      const bundle = await loadBundle(bundlePath, {
        kind: "user-global",
        rootPath: examplesDir,
        label: "examples",
      });
      const body = assembleBody(bundle.files);
      const result = validate({
        config: bundle.config,
        files: bundle.files,
        assembledBody: body,
      });

      // Surface any errors/warnings in the failure message so a CI failure
      // tells the maintainer exactly what drifted.
      if (!result.ok) {
        throw new Error(
          `Bundle ${name} failed validation:\n  errors: ${result.errors.join("\n  errors: ")}\n  warnings: ${result.warnings.join("\n  warnings: ")}`,
        );
      }
      expect(result.warnings).toEqual([]);
    });
  }
});
