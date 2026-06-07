#!/usr/bin/env bun
// agent-smith CLI entry point. Forwards to src/index.ts so npm-installed
// users get a `smith` command on PATH after `npm install -g agent-smith`.
// bun resolves the .ts extension natively; under node, the import will
// fail with a clear hint pointing at https://bun.sh.
import("../src/index.ts").catch((err) => {
  console.error("agent-smith requires bun >= 1.1.0 — install from https://bun.sh");
  console.error("Underlying error:", err.message);
  process.exit(1);
});
