import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, symlink, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBareRemote } from "../fixtures/git-remote-helper";
import { discoverFromUrl, scanBundleNames, deriveLabel, parseRemoteParts } from "../../src/core/install-from-url";

const SKILL = (n: string, d: string) => `---\nname: ${n}\ndescription: ${d}\n---\n# ${n}\n`;

let home: string; let prevCfg: string | undefined; let prevState: string | undefined;
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "discover-from-url-"));
  prevCfg = process.env.XDG_CONFIG_HOME; prevState = process.env.XDG_STATE_HOME;
  process.env.XDG_CONFIG_HOME = home; process.env.XDG_STATE_HOME = home;
});
afterEach(async () => {
  prevCfg === undefined ? delete process.env.XDG_CONFIG_HOME : (process.env.XDG_CONFIG_HOME = prevCfg);
  prevState === undefined ? delete process.env.XDG_STATE_HOME : (process.env.XDG_STATE_HOME = prevState);
  await rm(home, { recursive: true, force: true });
});

describe("discoverFromUrl", () => {
  test("clones and lists multiple skills WITHOUT writing the registry", async () => {
    const remote = await createBareRemote();
    try {
      await remote.commitFile("a/SKILL.md", SKILL("alpha", "First skill."));
      await remote.commitFile("b/SKILL.md", SKILL("beta", "Second skill."));
      const result = await discoverFromUrl({ kind: "skill", url: remote.url });
      expect(result.bundles.map((b) => b.name).sort()).toEqual(["alpha", "beta"]);
      expect(result.bundles.find((b) => b.name === "alpha")?.description).toBe("First skill.");
      expect(result.bundles.every((b) => b.alreadyInstalled === false)).toBe(true);
      expect(result.existingCatalog).toBeNull();
      expect(existsSync(join(home, ".config", "agent-smith", "skill-catalogs.json"))).toBe(false);
    } finally { await remote.cleanup(); }
  });
});

describe("scanBundleNames symlink hardening", () => {
  test("skips a SKILL.md that is a symlink", async () => {
    const root = await mkdtemp(join(tmpdir(), "scan-"));
    try {
      await mkdir(join(root, "real"), { recursive: true });
      await writeFile(join(root, "real", "SKILL.md"), SKILL("real", "ok"));
      await mkdir(join(root, "evil"), { recursive: true });
      const secret = join(root, "secret.txt");
      await writeFile(secret, "name: pwned\n");
      await symlink(secret, join(root, "evil", "SKILL.md"));
      const names = await scanBundleNames(root, "skill");
      expect(names).toEqual(["real"]);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});

describe("urlSegments shared logic", () => {
  test("deriveLabel produces owner/repo for normal URLs", () => {
    expect(deriveLabel("https://github.com/obra/superpowers")).toBe("obra/superpowers");
    expect(deriveLabel("git@github.com:eliharoun/agent-smith.git")).toBe("eliharoun/agent-smith");
    expect(deriveLabel("https://gitlab.com/team/sub/repo.git")).toBe("sub/repo");
  });

  test("parseRemoteParts extracts host/owner/repo", () => {
    const r = parseRemoteParts("https://github.com/obra/superpowers");
    expect(r).toEqual({ host: "github.com", owner: "obra", repo: "superpowers" });
  });

  test("parseRemoteParts with fewer than 3 segments sets owner to empty string", () => {
    const r = parseRemoteParts("https://github.com/solo");
    expect(r).toEqual({ host: "github.com", owner: "", repo: "solo" });
  });

  test("deriveLabel and parseRemoteParts agree on repo segment", () => {
    const url = "https://github.com/obra/superpowers.git";
    const label = deriveLabel(url);
    const parts = parseRemoteParts(url);
    expect(label).toBe(`${parts.owner}/${parts.repo}`);
  });
});
