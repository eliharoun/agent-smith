import { expect, test } from "bun:test";
import { missingBundleMessage } from "../../src/cli/commands/gui";

test("uses pnpm updateCommand when packaged via pnpm", async () => {
  const msg = await missingBundleMessage("/x/dist/index.html", async () => ({
    kind: "packaged",
    packageManager: "pnpm",
    workspacePath: "/store/agent-smith",
    updateCommand: "pnpm add -g @eliharoun/agent-smith",
    canGitUpdate: false,
  }));
  expect(msg).toContain("pnpm add -g @eliharoun/agent-smith");
});

test("falls back to static npm command when detection throws", async () => {
  const msg = await missingBundleMessage("/x/dist/index.html", async () => {
    throw new Error("boom");
  });
  expect(msg).toContain("npm i -g @eliharoun/agent-smith");
});
