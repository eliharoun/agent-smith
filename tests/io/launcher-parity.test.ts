import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildLauncherBody } from "../../src/io/launcher";

// Byte-parity guard: bin/install writes the launcher wrapper via a shell
// heredoc; src/io/launcher.ts writes it via buildLauncherBody(). The two
// MUST produce byte-identical output for the same bun + entry paths, because
// update-mode detection in bin/install greps a launcher that may have been
// written by either path. This test extracts bin/install's heredoc body,
// substitutes the same paths buildLauncherBody embeds, and asserts equality.

const REPO_ROOT = join(import.meta.dir, "..", "..");

/**
 * Render bin/install's launcher heredoc the way the shell would, given the
 * two interpolated variables ($BUN_PATH and $LAUNCHER_REPO). We read the
 * literal heredoc text from bin/install so any edit to the shell template
 * fails this test until launcher.ts is kept in sync.
 */
function renderShellLauncherBody(bunPath: string, launcherRepo: string): string {
  const installSrc = readFileSync(join(REPO_ROOT, "bin", "install"), "utf8");
  const start = installSrc.indexOf('cat > "$LAUNCHER" <<EOF\n');
  expect(start).toBeGreaterThanOrEqual(0);
  const bodyStart = installSrc.indexOf("\n", start) + 1;
  const bodyEnd = installSrc.indexOf("\nEOF\n", bodyStart);
  expect(bodyEnd).toBeGreaterThan(bodyStart);
  // Heredoc body, with the trailing newline before EOF restored.
  let body = installSrc.slice(bodyStart, bodyEnd) + "\n";
  // The unquoted-EOF heredoc interpolates $BUN_PATH and $LAUNCHER_REPO at
  // write time and keeps backslash-escaped sequences (\`, \$@) literal.
  body = body
    .replaceAll("\\`", "`")
    .replaceAll("$BUN_PATH", bunPath)
    .replaceAll("$LAUNCHER_REPO/src/index.ts", `${launcherRepo}/src/index.ts`)
    .replaceAll("\\$@", "$@");
  return body;
}

test("buildLauncherBody is byte-identical to bin/install's heredoc", () => {
  const bunPath = "/opt/homebrew/bin/bun";
  const repo = "/Users/x/code/agent-smith";
  const entryPath = `${repo}/src/index.ts`;

  const fromTs = buildLauncherBody(bunPath, entryPath);
  const fromShell = renderShellLauncherBody(bunPath, repo);

  expect(fromTs).toBe(fromShell);
});
