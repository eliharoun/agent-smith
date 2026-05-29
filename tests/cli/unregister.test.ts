import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { unregister } from "../../src/cli/commands/unregister";
import { SmithError } from "../../src/core/smith-error";
import { addSource, loadRegistry, saveRegistry } from "../../src/io/registry";

let tmp: string;
let registryPath: string;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "smith-unregister-"));
  registryPath = join(tmp, "registry.json");
  // Seed a registry with two sources so we can verify selective removal.
  let reg = await loadRegistry(registryPath);
  reg = addSource(reg, {
    kind: "project",
    rootPath: "/some/abs/path-a",
    label: "project:a",
  }).registry;
  reg = addSource(reg, {
    kind: "project",
    rootPath: "/some/abs/path-b",
    label: "project:b",
  }).registry;
  await saveRegistry(registryPath, reg);
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("cli/unregister", () => {
  test("removes the source whose rootPath matches and persists the change", async () => {
    const code = await unregister("/some/abs/path-a", { registryPath });
    expect(code).toBe(0);

    const reread = await loadRegistry(registryPath);
    expect(reread.sources.some((s) => s.rootPath === "/some/abs/path-a")).toBe(false);
    // Other source untouched.
    expect(reread.sources.some((s) => s.rootPath === "/some/abs/path-b")).toBe(true);
  });

  test("throws SmithError(not-found) when source is not registered", async () => {
    // Capture console.log so we can verify the registered-listing
    // remediation (CLI-9) appears alongside the SmithError.
    const captured: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      captured.push(args.map((a) => String(a)).join(" "));
    };
    let err: unknown;
    try {
      err = await unregister("/some/abs/no-such-path", { registryPath }).catch((e) => e);
    } finally {
      console.log = origLog;
    }
    expect(err).toBeInstanceOf(SmithError);
    const e = err as SmithError;
    expect(e.payload.code).toBe("not-found");
    if (e.payload.code === "not-found") {
      expect(e.payload.what).toMatch(/agent catalog/);
      expect(e.payload.identifier).toContain("/some/abs/no-such-path");
      expect(e.payload.suggestedCommand).toBe("smith agent list");
    }

    // CLI-9: stdout must show the currently-registered set so the user
    // can spot a fat-fingered path/label without re-running `smith agent list`.
    const merged = captured.join("\n");
    expect(merged).toMatch(/Currently registered:/);
    expect(merged).toContain("/some/abs/path-a");
    expect(merged).toContain("/some/abs/path-b");

    // Registry untouched.
    const reread = await loadRegistry(registryPath);
    expect(reread.sources).toHaveLength(3); // default user-global + 2 seeded
  });

  test("resolves a relative path argument the same way `register` does", async () => {
    // Add a source whose rootPath is the absolute resolution of "./examples"
    // from the CWD at test-run time. Then unregister using the relative form.
    const relativePath = "./examples";
    const absPath = resolve(relativePath);
    let reg = await loadRegistry(registryPath);
    reg = addSource(reg, {
      kind: "project",
      rootPath: absPath,
      label: "examples",
    }).registry;
    await saveRegistry(registryPath, reg);

    const code = await unregister(relativePath, { registryPath });
    expect(code).toBe(0);

    const reread = await loadRegistry(registryPath);
    expect(reread.sources.some((s) => s.rootPath === absPath)).toBe(false);
  });

  test("writes a newline-terminated JSON file (matches saveRegistry contract)", async () => {
    await unregister("/some/abs/path-a", { registryPath });
    const raw = await readFile(registryPath, "utf8");
    expect(raw.endsWith("\n")).toBe(true);
    // And it's still valid JSON.
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  test("accepts a label as the argument and removes the matching source", async () => {
    // 'project:a' is a label, not a path. Pre-this change the function only
    // resolved paths; now it tries label-match first and falls back to path.
    const code = await unregister("project:a", { registryPath });
    expect(code).toBe(0);
    const reread = await loadRegistry(registryPath);
    expect(reread.sources.some((s) => s.label === "project:a")).toBe(false);
    expect(reread.sources.some((s) => s.label === "project:b")).toBe(true);
  });

  test("when both a label and a path argument are valid, the label match wins", async () => {
    // Add a source whose rootPath happens to literally equal another source's
    // label. Calling `unregister "project:a"` must remove the label-matched
    // source, not the rootPath-matched one.
    let reg = await loadRegistry(registryPath);
    reg = addSource(reg, {
      kind: "project",
      rootPath: "project:a", // weird-but-legal: literal absolute-style or relative
      label: "weird-rootpath",
    }).registry;
    await saveRegistry(registryPath, reg);

    await unregister("project:a", { registryPath });
    const reread = await loadRegistry(registryPath);
    // Label "project:a" gone; rootPath "project:a" still present.
    expect(reread.sources.some((s) => s.label === "project:a")).toBe(false);
    expect(reread.sources.some((s) => s.rootPath === "project:a")).toBe(true);
  });

  test("[DW-8] accepts a label containing '/' (e.g. 'owner/repo' shape)", async () => {
    // Regression: remote-installed catalogs auto-derive labels like
    // 'fixture-bare/mini' or 'acme/team-agents' from the git URL. The
    // looksLikePath heuristic (input contains '/') was routing those
    // straight to the path branch and never trying a label lookup, so
    // 'smith agent unregister fixture-bare/mini' threw not-found even
    // though the label was right there in the registry.
    let reg = await loadRegistry(registryPath);
    reg = addSource(reg, {
      kind: "registered",
      rootPath: "/var/tmp/some-remote-clone-dir",
      label: "owner/repo",
    }).registry;
    await saveRegistry(registryPath, reg);

    const code = await unregister("owner/repo", { registryPath });
    expect(code).toBe(0);
    const reread = await loadRegistry(registryPath);
    expect(reread.sources.some((s) => s.label === "owner/repo")).toBe(false);
  });
});
