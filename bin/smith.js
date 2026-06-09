#!/usr/bin/env node
// agent-smith CLI entry point. Runs under node (always present alongside npm)
// OR bun. Resolves bun's ABSOLUTE path and re-execs src/index.ts so the binary
// works in stripped-PATH spawn contexts (Spotlight/dock, MCP clients, cron,
// launchd) where a `#!/usr/bin/env bun` shebang would fail. Source installs go
// through ~/.local/bin/smith (a bun-path-hardcoded wrapper), not this file.
const { spawnSync } = require("node:child_process");
const { accessSync, constants } = require("node:fs");
const { join } = require("node:path");
const { homedir } = require("node:os");

function isExe(p) {
  try {
    accessSync(p, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveBunAbsolute() {
  // SMITH_BUN is authoritative when defined (test/packaging seam): an explicit
  // override wins outright rather than silently falling through to a system
  // bun. Note: SMITH_BUN="" (empty) is treated as a deliberate failing override.
  const fromEnv = process.env.SMITH_BUN;
  if (fromEnv !== undefined) return isExe(fromEnv) ? fromEnv : null;
  // Absolute candidates first — these are exactly what survives a stripped PATH.
  // Cover the official installer plus the common version managers (asdf/mise/
  // volta), since their users would otherwise only be found by the PATH scan
  // below, which is the very thing that fails in stripped-PATH spawn contexts.
  const candidates = [
    join(homedir(), ".bun/bin/bun"),
    "/opt/homebrew/bin/bun",
    "/usr/local/bin/bun",
    "/usr/bin/bun",
    join(homedir(), ".asdf/shims/bun"),
    join(homedir(), ".local/share/mise/shims/bun"),
    join(homedir(), ".volta/bin/bun"),
  ];
  for (const c of candidates) if (isExe(c)) return c;
  for (const dir of (process.env.PATH || "").split(":")) {
    if (!dir) continue;
    const p = join(dir, "bun");
    if (isExe(p)) return p;
  }
  return null;
}

const bun = resolveBunAbsolute();
if (!bun) {
  console.error("agent-smith requires bun >= 1.1.0 — install from https://bun.sh");
  process.exit(1);
}
const entry = join(__dirname, "..", "src", "index.ts");
const r = spawnSync(bun, [entry, ...process.argv.slice(2)], { stdio: "inherit" });
// Surface a genuine exec failure (e.g. corrupt/wrong-arch bun) instead of a
// silent exit 1, and re-raise a terminating signal (Ctrl+C) rather than
// flattening it to exit 1 — matches npx/yarn conventions.
if (r.error) {
  console.error(`agent-smith: failed to launch bun (${r.error.code || "error"}): ${r.error.message}`);
  process.exit(1);
}
if (r.signal) {
  process.kill(process.pid, r.signal);
} else {
  process.exit(r.status == null ? 1 : r.status);
}
