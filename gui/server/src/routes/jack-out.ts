import { JackOutDryRun } from "gui-shared";
import type { Hono } from "hono";
import { smithBinaryPath } from "../services/smith-binary";

export interface JackOutSpawnResult {
  stdout: string;
  exitCode: number;
}

export interface JackOutRouteDeps {
  /**
   * Test seam. Defaults to `Bun.spawn([smithBinaryPath(), "jack-out", "--dry-run"])`.
   */
  spawn?: (argv: string[]) => Promise<JackOutSpawnResult>;
}

async function defaultSpawn(argv: string[]): Promise<JackOutSpawnResult> {
  const proc = Bun.spawn([smithBinaryPath(), ...argv], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  return { stdout, exitCode };
}

// Strip ANSI escapes so we can match consistently regardless of TTY heuristics.
// The leading character is ESC (U+001B). Constructed via RegExp() so we can
// inject the control character from String.fromCharCode without biome's
// noControlCharactersInRegex flagging the literal in a regex literal.
const ANSI = new RegExp(`${String.fromCharCode(0x1b)}\\[[0-9;]*[A-Za-z]`, "g");

/**
 * `GET /api/jack-out/dry-run` — synchronously runs `smith jack-out --dry-run`
 * (no `--json` flag exists; output is human-formatted text — see plan
 * Amendment N). Returns the verbatim `rawOutput` for authoritative
 * rendering, plus `lines[]` filtered to the indented path lines (≥4
 * leading spaces) for callers that want a terse summary. Read-only; no
 * lock taken.
 */
export function registerJackOutRoute(app: Hono, deps: JackOutRouteDeps = {}): void {
  const spawn = deps.spawn ?? defaultSpawn;
  app.get("/api/jack-out/dry-run", async (c) => {
    let result: JackOutSpawnResult;
    try {
      result = await spawn(["jack-out", "--dry-run"]);
    } catch (err) {
      return c.json({ error: "spawn-failed", message: String(err) }, 500);
    }
    const clean = result.stdout.replace(ANSI, "");
    const lines = clean
      .split(/\r?\n/)
      .filter((l) => /^ {4,}\S/.test(l))
      .map((l) => l.trimEnd());
    const body = JackOutDryRun.parse({ rawOutput: clean, lines });
    return c.json(body);
  });
}
