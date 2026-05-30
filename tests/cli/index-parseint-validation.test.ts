import { describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";

function runCli(args: string[]): Promise<{ code: number; stderr: string; stdout: string }> {
  return new Promise((resolve) => {
    const proc = spawn("bun", ["src/index.ts", ...args], {
      cwd: process.cwd(),
    });
    let stderr = "";
    let stdout = "";
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.on("close", (code) => resolve({ code: code ?? -1, stderr, stdout }));
  });
}

describe("commander int validation", () => {
  test("--max-pages abc rejects with non-zero exit and clear message", async () => {
    const { code, stderr } = await runCli([
      "knowledge", "add", "dummy-agent", "confluence", "--max-pages", "abc",
    ]);
    expect(code).not.toBe(0);
    expect(stderr.toLowerCase()).toContain("max-pages");
    expect(stderr.toLowerCase()).toMatch(/integer|number|nan/);
  });

  test("--max-results xyz rejects similarly", async () => {
    const { code, stderr } = await runCli([
      "knowledge", "add", "dummy-agent", "jira", "--max-results", "xyz",
    ]);
    expect(code).not.toBe(0);
    expect(stderr.toLowerCase()).toContain("max-results");
  });

  test("--max-pages 42 parses successfully", async () => {
    // The command will later fail for other reasons (no such agent), but
    // the integer parse must succeed — i.e. the integer error message must NOT appear.
    const { stderr } = await runCli([
      "knowledge", "add", "dummy-agent", "confluence", "--max-pages", "42",
    ]);
    expect(stderr.toLowerCase()).not.toMatch(/must be an integer/);
  });
});
