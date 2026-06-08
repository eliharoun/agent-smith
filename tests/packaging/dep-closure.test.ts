import { describe, expect, test } from "bun:test";
import { join } from "node:path";

// Repo root: this file is at tests/packaging/, so two dirs up.
const REPO_ROOT = join(import.meta.dir, "..", "..");

// The external (non-Bun, non-gui-shared) runtime deps the GUI server reaches,
// directly or via its `../../../../src/*` cross-imports into the CLI core. All
// MUST resolve from the package root in a flat npm install. `hono` is the one
// that was missing before this change. This is a fast dev-time guard for the
// CURRENT dep surface — the authoritative closure gate is the clean-room
// tarball smoke test (Task 8), which exercises a real `npm install`.
// NOTE: `commander` is deliberately excluded — it is a CLI-entry dependency
// (`src/cli/**`) the GUI server never imports, so it is out of this closure.
const REQUIRED = [
  "hono",
  "zod",
  "js-yaml",
  "dotenv",
  "smol-toml",
  "jsdom",
  "turndown",
  "turndown-plugin-gfm",
  "tar",
  "@mozilla/readability",
  "gray-matter",
];

describe("packaging constraints", () => {
  test.each(REQUIRED)("GUI runtime dep %s resolves from package root", (pkg) => {
    expect(() => Bun.resolveSync(pkg, REPO_ROOT)).not.toThrow();
  });
});
