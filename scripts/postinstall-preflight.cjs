#!/usr/bin/env node
// Postinstall preflight — runs under node so it works regardless of bun's
// presence. Skips silently when bun isn't available (with a one-line hint),
// or when this is a transitive-dep install (so we only fire on the user's
// explicit `npm install -g agent-smith`), or when the user opted out.
//
// Real work is delegated to scripts/bootstrap.ts which requires bun.

const { execSync } = require("node:child_process");
const path = require("node:path");

// Opt-out gates.
if (process.env.AGENT_SMITH_SKIP_POSTINSTALL === "1") process.exit(0);
if (process.env.CI === "true") process.exit(0);

// Transitive-dep detection. INIT_CWD is npm's "where the user invoked
// npm" path; if it's NOT the agent-smith package dir, this is a transitive
// install of agent-smith as a dependency of something else. Skip — the
// downstream user didn't ask for our setup work.
const packageDir = path.resolve(__dirname, "..");
const initCwd = process.env.INIT_CWD || process.cwd();
if (initCwd !== packageDir && !process.env.npm_config_global) {
  // Don't print anything — the most common case is "I'm a transitive dep"
  // and downstream users shouldn't see noise about our setup.
  process.exit(0);
}

// Detect bun on PATH.
let bunOk = false;
try {
  execSync("command -v bun", { stdio: "ignore" });
  bunOk = true;
} catch {
  // bun not found.
}

if (!bunOk) {
  console.error("agent-smith: bun not detected on PATH.");
  console.error(
    "agent-smith: install bun from https://bun.sh, then run `smith agent install agent-smith` to complete setup.",
  );
  console.error("agent-smith: skipping postinstall.");
  process.exit(0); // Exit 0 so npm install succeeds; smith just isn't bootstrapped.
}

// Bun is available — delegate to the existing bootstrap.
try {
  execSync("bun run scripts/bootstrap.ts --mode=postinstall", {
    cwd: packageDir,
    stdio: "inherit",
  });
} catch (err) {
  console.error(
    "agent-smith: postinstall encountered an error (non-fatal):",
    err.message,
  );
  // Always exit 0 — never break the user's npm install.
}
process.exit(0);
