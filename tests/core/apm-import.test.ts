import { describe, expect, it } from "bun:test";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importApmBundle } from "../../src/core/apm-import";

const APM_YAML = `name: demo
version: 0.1.0
description: Reviews PRs for type-safety.
runtimes: [claude-code, opencode]
references:
  - url: https://example.com/style.md
  - file: ./docs/onboarding.md
`;

describe("importApmBundle", () => {
  it("converts apm.yml into a smith CanonicalConfig + persona stubs", async () => {
    const root = await mkdtemp(join(tmpdir(), "apm-"));
    await mkdir(join(root, "docs"), { recursive: true });
    await writeFile(join(root, "apm.yml"), APM_YAML);
    await writeFile(join(root, "docs/onboarding.md"), "Onboarding doc");

    const out = await importApmBundle({ apmPath: join(root, "apm.yml") });
    expect(out.config.name).toBe("demo");
    expect(out.config.targets).toEqual(["claude-code", "opencode"]);
    expect(out.config.knowledge?.sources?.length).toBe(2);
    expect(out.config.knowledge?.compile?.progressive).toBe(true);
    expect(out.config.knowledge?.compile?.emitAgentsMd).toBe(true);
    expect(out.persona.identity).toContain("demo");

    await rm(root, { recursive: true, force: true });
  });

  it("maps non-native runtimes (cursor, copilot, gemini, windsurf) to agents-md", async () => {
    const root = await mkdtemp(join(tmpdir(), "apm-"));
    const yaml = `name: demo
description: Reviews PRs for everything.
runtimes: [cursor, copilot]
references: []
`;
    await writeFile(join(root, "apm.yml"), yaml);
    const out = await importApmBundle({ apmPath: join(root, "apm.yml") });
    expect(out.config.targets).toContain("agents-md");
    await rm(root, { recursive: true, force: true });
  });

  it("throws when name is missing", async () => {
    const root = await mkdtemp(join(tmpdir(), "apm-"));
    await writeFile(join(root, "apm.yml"), "description: x\nruntimes: [claude-code]\n");
    await expect(importApmBundle({ apmPath: join(root, "apm.yml") })).rejects.toThrow(/name/i);
    await rm(root, { recursive: true, force: true });
  });

  it("throws when no recognized runtimes", async () => {
    const root = await mkdtemp(join(tmpdir(), "apm-"));
    await writeFile(
      join(root, "apm.yml"),
      "name: demo\ndescription: Reviews things.\nruntimes: []\n",
    );
    await expect(importApmBundle({ apmPath: join(root, "apm.yml") })).rejects.toThrow(/runtime/i);
    await rm(root, { recursive: true, force: true });
  });
});
