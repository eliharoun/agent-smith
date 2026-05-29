// CLI wiring tests for `smith skill bootstrap`. Spawns smith as a
// subprocess and inspects exit codes + stdout. Mirrors
// tests/cli/init-agent.test.ts. Replaces the pre-rename
// tests/cli/bootstrap.test.ts.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let tmp: string;
let smithPath: string;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "smith-skill-bootstrap-cli-"));
  smithPath = join(import.meta.dir, "../../../src/index.ts");
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("smith bootstrap (deprecated, hard-removed)", () => {
  // The pre-Batch-20 surface name. After consolidation this command no
  // longer exists. Commander's unknown-command path returns exit 2 via
  // formatCommanderError → src/index.ts:543. Pinning this prevents a
  // future regression where someone re-adds `program.command("bootstrap")`
  // without going through the docs migration.
  test("`smith bootstrap` returns 'unknown command' with exit 2", async () => {
    const proc = Bun.spawnSync([process.execPath, smithPath, "bootstrap"], {
      cwd: tmp,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(proc.exitCode).toBe(2);
    const out = (proc.stdout.toString() + proc.stderr.toString()).toLowerCase();
    expect(out).toMatch(/unknown command|invalid command/);
  });
});

describe("smith skill bootstrap CLI", () => {
  test("--help describes the command", async () => {
    const proc = Bun.spawnSync(
      [process.execPath, smithPath, "skill", "bootstrap", "--help"],
      {
        cwd: tmp,
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    expect(proc.exitCode).toBe(0);
    const out = proc.stdout.toString();
    expect(out).toContain("bootstrap");
    // Should mention the bundled skill names so users searching --help
    // for "the-architect" or "the-keymaker" find this command.
    expect(out).toMatch(/the-architect|the-keymaker|bundled/i);
  });

  test("--dry-run exits 0 and reports plan", async () => {
    // Run from the repo root so bootstrap finds skills/ at the right path.
    const repo = join(import.meta.dir, "../../..");
    const proc = Bun.spawnSync(
      [process.execPath, smithPath, "skill", "bootstrap", "--dry-run"],
      {
        cwd: repo,
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    expect(proc.exitCode).toBe(0);
    const out = proc.stdout.toString() + proc.stderr.toString();
    expect(out.toLowerCase()).toContain("dry");
  });

  // CLI-28: typo'd target keys must be rejected upfront. Pre-this guard,
  // `--targets opnecode,claude-code` silently ran only claude-code
  // because the bogus key was filtered out of the platforms map. Users
  // believed both ran.
  test("unknown --targets value throws SmithError(usage-error) naming the typo", async () => {
    const { runSkillBootstrapCli } = await import(
      "../../../src/cli/commands/skill/bootstrap"
    );
    const { SmithError } = await import("../../../src/core/smith-error");
    const caught = await runSkillBootstrapCli({ targets: "opnecode" }).catch(
      (e) => e,
    );
    expect(caught).toBeInstanceOf(SmithError);
    const err = caught as InstanceType<typeof SmithError>;
    expect(err.payload.code).toBe("usage-error");
    if (err.payload.code === "usage-error") {
      expect(err.payload.message).toMatch(/opnecode/);
      expect(err.payload.message).toMatch(/opencode/);
      expect(err.payload.message).toMatch(/claude-code/);
      expect(err.payload.message).toMatch(/codex/);
      expect(err.payload.suggestedCommand).toMatch(/--targets/);
      // Suggested command must reference the new surface, not the old.
      expect(err.payload.suggestedCommand).toMatch(/skill bootstrap/);
    }
  });

  test("partially-typo'd --targets value rejects on the bad key (no silent drop)", async () => {
    const { runSkillBootstrapCli } = await import(
      "../../../src/cli/commands/skill/bootstrap"
    );
    const { SmithError } = await import("../../../src/core/smith-error");
    const caught = await runSkillBootstrapCli({
      targets: "opnecode,claude-code",
    }).catch((e) => e);
    expect(caught).toBeInstanceOf(SmithError);
    const err = caught as InstanceType<typeof SmithError>;
    expect(err.payload.code).toBe("usage-error");
    if (err.payload.code === "usage-error") {
      expect(err.payload.message).toMatch(/opnecode/);
    }
  });
});
