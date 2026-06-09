import { afterEach, beforeEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

// Resolve the directory containing the `node` binary so PATH-scrubbed cases can
// still START node (the shim itself runs under node) while excluding `bun`.
// `which node` is portable across Homebrew/asdf/system layouts; fall back to a
// common location if it can't be resolved.
const NODE_DIR = (() => {
  const which = spawnSync("which", ["node"], { encoding: "utf8" });
  const p = which.status === 0 ? which.stdout.trim() : "";
  return p ? dirname(p) : "/usr/bin";
})();

let tmp: string;
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "smith-shim-"));
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

const SHIM = join(import.meta.dir, "..", "..", "bin", "smith.js");

async function fakeBun(exitCode: number): Promise<string> {
  const p = join(tmp, "fake-bun");
  await writeFile(
    p,
    `#!/usr/bin/env bash\n` + `shift\n` + `echo "ARGS:$@"\n` + `exit ${exitCode}\n`,
    "utf8",
  );
  await chmod(p, 0o755);
  return p;
}

test("forwards args to bun and propagates exit code 0", async () => {
  const bun = await fakeBun(0);
  const r = spawnSync("node", [SHIM, "agent", "list"], {
    env: { ...process.env, SMITH_BUN: bun },
    encoding: "utf8",
  });
  expect(r.status).toBe(0);
  expect(r.stdout).toContain("ARGS:agent list");
});

test("propagates a non-zero exit code", async () => {
  const bun = await fakeBun(3);
  const r = spawnSync("node", [SHIM, "doctor"], {
    env: { ...process.env, SMITH_BUN: bun },
    encoding: "utf8",
  });
  expect(r.status).toBe(3);
});

test("exits 1 with a clear message when bun cannot be found", async () => {
  // PATH includes node's dir (so the `node` spawn can start) + an empty tmp dir,
  // but NOT bun. SMITH_BUN points at a non-executable, so the seam can't resolve
  // bun and the candidate/PATH scan finds none either.
  const r = spawnSync("node", [SHIM, "doctor"], {
    env: { SMITH_BUN: join(tmp, "nope"), PATH: `${NODE_DIR}:${tmp}` },
    encoding: "utf8",
  });
  expect(r.status).toBe(1);
  expect(r.stderr).toContain("requires bun");
});
