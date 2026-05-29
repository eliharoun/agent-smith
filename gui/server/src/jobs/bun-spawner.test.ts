import { describe, expect, it } from "bun:test";
import { createBunSpawner } from "./bun-spawner";

describe("bun spawner", () => {
  it("streams stdout and resolves exit code 0", async () => {
    const spawn = createBunSpawner({ binary: "/bin/echo" });
    const lines: string[] = [];
    let code = -1;
    await new Promise<void>((resolve) => {
      spawn(["hello", "world"], {
        onStdout: (c) => lines.push(c),
        onStderr: () => {},
        onExit: (c) => {
          code = c;
          resolve();
        },
      });
    });
    expect(code).toBe(0);
    expect(lines.join("")).toContain("hello world");
  });

  it("streams stderr and reports non-zero exit", async () => {
    const spawn = createBunSpawner({ binary: "/bin/sh" });
    let code = -1;
    const errs: string[] = [];
    await new Promise<void>((resolve) => {
      spawn(["-c", "echo bad 1>&2; exit 3"], {
        onStdout: () => {},
        onStderr: (c) => errs.push(c),
        onExit: (c) => {
          code = c;
          resolve();
        },
      });
    });
    expect(code).toBe(3);
    expect(errs.join("")).toContain("bad");
  });
});
