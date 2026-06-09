import { expect, test } from "bun:test";
import { installLauncher } from "../../scripts/bootstrap";
import type { InstallInfo } from "../../src/io/install-type";

const PACKAGED = {
  kind: "packaged",
  packageManager: "npm",
  workspacePath: "/opt/homebrew/lib/node_modules/@eliharoun/agent-smith",
  updateCommand: "npm install -g @eliharoun/agent-smith",
  canGitUpdate: false,
} satisfies InstallInfo;

test("source install → no-op, ok", async () => {
  const r = await installLauncher({
    installInfo: { ...PACKAGED, kind: "source", canGitUpdate: true },
    writeLauncherFn: async () => {
      throw new Error("must not write for source");
    },
  });
  expect(r.ok).toBe(true);
  expect(r.note).toContain("source");
});

test("packaged install → writes via writeLauncher", async () => {
  let calledWith: string | undefined;
  const r = await installLauncher({
    installInfo: PACKAGED,
    writeLauncherFn: async (o) => {
      calledWith = o.workspacePath;
      return { ok: true, launcherPath: "/home/x/.local/bin/smith", bunPath: "/b", entryPath: "/e" };
    },
  });
  expect(calledWith).toBe(PACKAGED.workspacePath);
  expect(r.ok).toBe(true);
});

test("unknown install → skip, not-ok", async () => {
  const r = await installLauncher({
    installInfo: {
      kind: "unknown",
      packageManager: "unknown",
      workspacePath: null,
      updateCommand: null,
      canGitUpdate: false,
    },
    writeLauncherFn: async () => {
      throw new Error("must not write for unknown");
    },
  });
  expect(r.ok).toBe(false);
});

test("write failure → not-ok with error note (fail-soft, no throw)", async () => {
  const r = await installLauncher({
    installInfo: PACKAGED,
    writeLauncherFn: async () => ({ ok: false, error: "EACCES ~/.local/bin" }),
  });
  expect(r.ok).toBe(false);
  expect(r.note).toContain("EACCES");
});
