#!/usr/bin/env bun
// scripts/verify-tarball.ts
// Integration gate: pack the real tarball, install it into a clean temp dir
// (only declared `dependencies` installed — no workspace, no gui-shared symlink),
// boot `smith gui`, and assert it serves the SPA + an API route. Exit non-zero
// on any failure. All resources (temp dir, .tgz, child process) are released in
// `finally` so a failed assertion can't leak a running server or an artifact.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = process.cwd();
const installDir = mkdtempSync(join(tmpdir(), "smith-tarball-"));

/**
 * The tarball name `npm pack` writes is deterministic from the manifest:
 * a leading `@` is dropped and every `/` becomes `-`, then `-<version>.tgz`.
 * We compute it rather than parse `npm pack --json`, because the `prepack`
 * build streams its own output to stdout ahead of the JSON payload — there is
 * no reliable, npm-version-independent way to slice the JSON back out.
 */
function tarballName(): string {
  const pkg = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8"));
  const base = String(pkg.name).replace(/^@/, "").replace(/\//g, "-");
  return `${base}-${pkg.version}.tgz`;
}

function run(cmd: string[], cwd: string, env: Record<string, string> = {}) {
  const p = Bun.spawnSync(cmd, { cwd, env: { ...process.env, ...env }, stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) {
    throw new Error(`cmd failed (${p.exitCode}): ${cmd.join(" ")}\n${p.stderr.toString()}`);
  }
  return p.stdout.toString();
}

let failed = false;
// Capture a kill handle (not the typed Subprocess itself) so `finally` can
// stop the server without widening `proc`'s inferred type — annotating it as
// ReturnType<typeof Bun.spawn> loses the precise stdout-stream type that
// `.getReader()` needs.
let killServer: (() => void) | undefined;
let tgzPath: string | undefined;
try {
  // 1. Pack (runs prepack build+prune, postpack restore). The filename is
  //    computed from the manifest (see tarballName) rather than scraped from
  //    npm's stdout, which the prepack build pollutes. Pack into REPO so the
  //    deterministic name lands where we expect it.
  tgzPath = join(REPO, tarballName());
  run(["npm", "pack"], REPO);
  if (!existsSync(tgzPath)) {
    throw new Error(`expected tarball not found at ${tgzPath} after npm pack — name convention may have changed`);
  }

  // 2. Tarball-content assertions on the real artifact.
  const list = run(["tar", "-tf", tgzPath], REPO);
  const must = ["package/gui/web/dist/index.html", "package/gui/server/src/index.ts",
                "package/gui/shared/src/index.ts"];
  for (const m of must) if (!list.includes(m)) throw new Error(`tarball missing: ${m}`);
  for (const re of [/\.test\.tsx?\n/, /__snapshots__\//, /\.map\n/, /gui\/web\/src\//, /gui\/README\.md\n/]) {
    if (re.test(list)) throw new Error(`tarball leaked forbidden path: ${re}`);
  }

  // 3. Clean-room install (only declared dependencies). CI=true makes the
  //    package's postinstall preflight no-op so it can't interfere with the gate.
  writeFileSync(join(installDir, "package.json"), JSON.stringify({ name: "consumer", version: "1.0.0", private: true }));
  run(["npm", "install", tgzPath], installDir, { CI: "true" });

  // 4. Boot the installed binary on an ephemeral port and probe it.
  const binDir = join(installDir, "node_modules", ".bin");
  const proc = Bun.spawn([join(binDir, "smith"), "gui", "--no-open", "--port", "0", "--bind", "127.0.0.1"], {
    cwd: installDir, env: { ...process.env, SMITH_GUI_DEV_TOKEN: "smoke-token" }, stdout: "pipe", stderr: "pipe",
  });
  killServer = () => proc.kill();
  // Read stdout until the "smith gui ready at <url>" line appears.
  const reader = proc.stdout.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let url = "";
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline && !url) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value);
    const m = buf.match(/ready at (http:\/\/\S+)/);
    if (m) url = m[1];
  }
  if (!url) throw new Error(`server did not report a ready URL.\n${buf}`);

  // Bound each probe so a hung response fails the gate in seconds, not at the
  // job's 20-minute timeout.
  const base = new URL(url);
  const root = await fetch(`${base.origin}/?token=smoke-token`, { signal: AbortSignal.timeout(10_000) });
  const body = await root.text();
  if (root.status !== 200 || !/<!doctype html/i.test(body)) {
    throw new Error(`GET / unexpected: status=${root.status} body=${body.slice(0, 120)}`);
  }
  const api = await fetch(`${base.origin}/api/status?token=smoke-token`, { signal: AbortSignal.timeout(10_000) });
  if (api.status !== 200) throw new Error(`/api/status status=${api.status}`);

  console.log("TARBALL_SMOKE_OK");
} catch (err) {
  failed = true;
  console.error("TARBALL_SMOKE_FAILED:", err instanceof Error ? err.message : String(err));
} finally {
  killServer?.();
  if (tgzPath) rmSync(tgzPath, { force: true });
  rmSync(installDir, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
