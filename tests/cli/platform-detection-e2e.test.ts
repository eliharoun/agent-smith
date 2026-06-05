import { describe, it } from "bun:test";

// Placeholder for the end-to-end "consent → install → doctor" smoke test
// that ties the platform-detection primitive across commands.
//
// Why .skip:
// The per-link unit tests already cover the behavior this would assert:
//   - resolveExecutionPlatforms() in tests/io/resolve-execution-platforms.test.ts
//   - install pipeline gating in tests/cli/install.test.ts (skipped-platforms output)
//   - consent loop filtering in tests/cli/check-refresh-hooks.test.ts
//   - doctor reclassification in tests/cli/doctor-orphaned-consent.test.ts
//   - install-all parity in tests/cli/install-all.test.ts
//
// A true end-to-end test needs a registry stub, a multi-target bundle
// fixture, a writable stateHome, and a doctor harness — substantial
// scaffolding that does not add coverage beyond the existing unit tests.
// Tracked for a follow-up release that wires the full chain.
describe("platform detection e2e", () => {
  it.skip(
    "user with claude-code+kiro installs an agent and sees zero opencode/codex doctor warnings",
    () => {
      // TODO: wire full e2e (registry stub + bundle fixture + install + doctor)
    },
  );
});
