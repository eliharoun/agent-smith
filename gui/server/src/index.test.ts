import { describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGuiJobManager, displayHost } from "./index";
import type { Spawner } from "./jobs/job-manager";

describe("displayHost", () => {
  it("returns the bind unchanged for loopback IPv4", () => {
    expect(displayHost("127.0.0.1")).toBe("127.0.0.1");
  });

  it("rewrites 0.0.0.0 to 127.0.0.1 (browsers refuse 0.0.0.0)", () => {
    expect(displayHost("0.0.0.0")).toBe("127.0.0.1");
  });

  it("rewrites :: to 127.0.0.1", () => {
    expect(displayHost("::")).toBe("127.0.0.1");
  });

  it("rewrites ::0 to 127.0.0.1", () => {
    expect(displayHost("::0")).toBe("127.0.0.1");
  });

  it("returns 'localhost' unchanged", () => {
    expect(displayHost("localhost")).toBe("localhost");
  });

  it("returns specific bind addresses unchanged", () => {
    expect(displayHost("192.168.1.10")).toBe("192.168.1.10");
  });
});

// Poll for a file rather than sleeping: finalize() runs in a microtask after
// the job's onExit, so the JSONL write lands shortly after waitForExit resolves.
async function waitForFile(path: string, timeoutMs = 2000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      return await readFile(path, "utf8");
    } catch {
      if (Date.now() > deadline) throw new Error(`timeout waiting for ${path}`);
      await new Promise((r) => setTimeout(r, 20));
    }
  }
}

describe("createGuiJobManager", () => {
  it("wires history so a completed job persists to gui-jobs.jsonl + output log", async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), "gui-state-"));
    const spawner: Spawner = (_argv, h) => {
      h.onStdout("hello from job\n");
      h.onExit(0);
      return { stop: () => {}, writeStdin: () => {} };
    };
    const jm = createGuiJobManager({ spawner, stateRoot });
    const { id } = jm.start({
      command: "doctor",
      argv: ["doctor"],
      preview: "smith doctor",
      lockKeys: [],
    });
    await jm.waitForExit(id);

    const jsonl = await waitForFile(join(stateRoot, "gui-jobs.jsonl"));
    expect(jsonl).toContain('"command":"doctor"');
    const log = await waitForFile(join(stateRoot, "gui-jobs-output", `${id}.log`));
    expect(log).toContain("hello from job");

    await rm(stateRoot, { recursive: true, force: true });
  });
});
