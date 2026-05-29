import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentCatalogs } from "../../src/cli/commands/agent/catalogs";
import { saveRegistry, type Registry } from "../../src/io/registry";

let dir: string;
let registryPath: string;
let logSpy: ReturnType<typeof spyOn>;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "smith-agent-cats-"));
  registryPath = join(dir, "registry.json");
  logSpy = spyOn(console, "log").mockImplementation(() => {});
});
afterEach(async () => {
  logSpy.mockRestore();
  await rm(dir, { recursive: true, force: true });
});

describe("cli/agent catalogs", () => {
  test("prints one line per registered source: kind, label, rootPath", async () => {
    const reg: Registry = {
      schemaVersion: 2,
      sources: [
        { kind: "user-global", rootPath: "/tmp/aa", label: "alpha" },
        { kind: "registered", rootPath: "/tmp/bb", label: "beta", gitRemote: "git@example.com:x.git" },
      ],
    };
    await saveRegistry(registryPath, reg);
    const code = await agentCatalogs({ registryPath });
    expect(code).toBe(0);
    const out = logSpy.mock.calls.flat().join(" ");
    expect(out).toContain("alpha");
    expect(out).toContain("/tmp/aa");
    expect(out).toContain("user-global");
    expect(out).toContain("beta");
    expect(out).toContain("/tmp/bb");
    expect(out).toContain("registered");
    expect(out).toContain("git@example.com:x.git");
  });

  test("prints '(no catalogs registered)' when sources is empty", async () => {
    // Note: defaultRegistry seeds a user-global entry, so an empty sources
    // array only arises from a hand-written file. Test pins behavior.
    const reg: Registry = { schemaVersion: 2, sources: [] };
    await saveRegistry(registryPath, reg);
    const code = await agentCatalogs({ registryPath });
    expect(code).toBe(0);
    const out = logSpy.mock.calls.flat().join(" ");
    expect(out).toContain("no catalogs registered");
  });
});
