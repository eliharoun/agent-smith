import { describe, expect, it } from "bun:test";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("smith daemon run stays alive past initial install", () => {
  it("keeps the process alive until SIGTERM, exits within 2s after signal", async () => {
    const root = mkdtempSync(join(tmpdir(), "smith-daemon-run-"));
    const xdgState = join(root, "state");
    const xdgConfig = join(root, "config");
    const xdgCache = join(root, "cache");
    try {
      // Bootstrap a minimal config so loadRegistry succeeds.
      const initEnv = {
        ...process.env,
        XDG_STATE_HOME: xdgState,
        XDG_CONFIG_HOME: xdgConfig,
        XDG_CACHE_HOME: xdgCache,
      } as NodeJS.ProcessEnv;
      await new Promise<void>((resolve, reject) => {
        const init = spawn(process.execPath, ["src/index.ts", "init"], {
          env: initEnv,
          cwd: process.cwd(),
          stdio: "ignore",
        });
        init.on("exit", (code) =>
          code === 0 ? resolve() : reject(new Error(`init exited ${code}`)),
        );
      });

      // Spawn `bun src/index.ts daemon run` in the same isolated env.
      const child = spawn(process.execPath, ["src/index.ts", "daemon", "run"], {
        env: initEnv,
        cwd: process.cwd(),
        stdio: ["ignore", "ignore", "ignore"],
      });
      const childPid = child.pid;
      expect(childPid).toBeDefined();

      // Wait 4 seconds. Pre-fix the child dies ~2.5s after spawn (setup
      // completes, wrap returns, process.exit(0) fires).
      await new Promise((r) => setTimeout(r, 4000));

      // Assert process is still alive.
      let alive = false;
      try {
        process.kill(childPid!, 0);
        alive = true;
      } catch {
        alive = false;
      }
      expect(alive).toBe(true);

      // Send SIGTERM; assert exits within 2s.
      const exitCodePromise = new Promise<number | null>((resolve) => {
        child.on("exit", (code) => resolve(code));
      });
      child.kill("SIGTERM");
      const exitCode = await Promise.race([
        exitCodePromise,
        new Promise<"timeout">((r) => setTimeout(() => r("timeout"), 2000)),
      ]);
      expect(exitCode).not.toBe("timeout");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 15_000);
});
