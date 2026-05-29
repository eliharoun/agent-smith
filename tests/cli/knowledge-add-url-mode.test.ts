import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { deriveIdFromTitle, knowledgeAdd } from "../../src/cli/commands/knowledge/add";

describe("deriveIdFromTitle", () => {
  it("returns space-slug + slugified title when no collision", () => {
    expect(
      deriveIdFromTitle("snxexit", "Power BI Desktop - Security Model", 368024588, []),
    ).toBe("snxexit-power-bi-desktop-security-model");
  });

  it("appends numeric id on collision", () => {
    expect(
      deriveIdFromTitle("snxexit", "Power BI Desktop - Security Model", 368024588, [
        "snxexit-power-bi-desktop-security-model",
      ]),
    ).toBe("snxexit-power-bi-desktop-security-model-368024588");
  });

  it("falls back to numeric id when title is null", () => {
    expect(deriveIdFromTitle("snxexit", null, 42, [])).toBe("snxexit-42");
  });

  it("falls back to numeric id when title slugifies to empty", () => {
    expect(deriveIdFromTitle("snxexit", "!!!", 42, [])).toBe("snxexit-42");
  });

  it("falls back to numeric id when title is empty string", () => {
    expect(deriveIdFromTitle("snxexit", "", 42, [])).toBe("snxexit-42");
  });

  it("preserves disambiguation when title slug exceeds the 60-char cap", () => {
    const longTitle = "a".repeat(100);
    const candidateId = "snx-" + "a".repeat(56); // what truncateSlug(`snx-${"a"*100}`) produces
    const result = deriveIdFromTitle("snx", longTitle, 368024588, [candidateId]);
    // Must differ from candidateId so config doesn't silently overwrite
    expect(result).not.toBe(candidateId);
    // And it must still incorporate the numeric id
    expect(result).toContain("368024588");
  });

  it("falls back to numeric-id form when spaceSlug alone leaves no room", () => {
    const reallyLongSpace = "x".repeat(80);
    const result = deriveIdFromTitle(reallyLongSpace, "anything", 42, []);
    // No assertion about exact shape, just that it's non-empty and includes the numeric id
    expect(result.length).toBeGreaterThan(0);
    expect(result).toContain("42");
  });
});

describe("knowledgeAdd urlMode integration", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "smith-ka-url-"));
    await writeFile(
      join(dir, "agent.config.json"),
      JSON.stringify({
        name: "x",
        description: "Use to test things.",
        targets: ["opencode"],
        modelTier: "balanced",
      }),
    );
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("uses deriveIdFromTitle when urlMode.titleId is set (confluence)", async () => {
    const code = await knowledgeAdd({
      bundleDir: dir,
      type: "confluence",
      pathOrUrl: "SNXEXIT",
      pages: "id:368024588",
      format: "markdown",
      urlMode: {
        label: "Confluence page",
        titleId: { title: "Power BI Desktop - Security Model", numericId: 368024588 },
      },
    });
    expect(code).toBe(0);
    const cfg = JSON.parse(await readFile(join(dir, "agent.config.json"), "utf8"));
    expect(cfg.knowledge.sources[0].id).toBe("snxexit-power-bi-desktop-security-model");
  });

  it("appends numeric id on title collision", async () => {
    await knowledgeAdd({
      bundleDir: dir,
      type: "confluence",
      pathOrUrl: "SNXEXIT",
      id: "snxexit-power-bi-desktop-security-model",
    });
    const code = await knowledgeAdd({
      bundleDir: dir,
      type: "confluence",
      pathOrUrl: "SNXEXIT",
      pages: "id:368024588",
      format: "markdown",
      urlMode: {
        label: "Confluence page",
        titleId: { title: "Power BI Desktop - Security Model", numericId: 368024588 },
      },
    });
    expect(code).toBe(0);
    const cfg = JSON.parse(await readFile(join(dir, "agent.config.json"), "utf8"));
    expect(cfg.knowledge.sources[1].id).toBe(
      "snxexit-power-bi-desktop-security-model-368024588",
    );
  });

  it("explicit --id wins over urlMode title derivation", async () => {
    const code = await knowledgeAdd({
      bundleDir: dir,
      type: "confluence",
      pathOrUrl: "SNXEXIT",
      pages: "id:5",
      id: "my-custom-id",
      urlMode: {
        label: "Confluence page",
        titleId: { title: "Anything", numericId: 5 },
      },
    });
    expect(code).toBe(0);
    const cfg = JSON.parse(await readFile(join(dir, "agent.config.json"), "utf8"));
    expect(cfg.knowledge.sources[0].id).toBe("my-custom-id");
  });

  it("urlMode without titleId leaves existing deriveId behavior intact (jira-issue case)", async () => {
    const code = await knowledgeAdd({
      bundleDir: dir,
      type: "jira",
      pathOrUrl: "key = ENG-1234",
      urlMode: { label: "Jira issue" },
    });
    expect(code).toBe(0);
    const cfg = JSON.parse(await readFile(join(dir, "agent.config.json"), "utf8"));
    // Existing deriveId for jira: slugify(pathOrUrl) with quotes stripped.
    expect(cfg.knowledge.sources[0].id).toMatch(/^key-eng-1234/);
  });

  it("success message includes the urlMode label", async () => {
    const lines: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    };
    try {
      await knowledgeAdd({
        bundleDir: dir,
        type: "confluence",
        pathOrUrl: "SNXEXIT",
        pages: "id:5",
        urlMode: {
          label: "Confluence page",
          titleId: { title: "Demo", numericId: 5 },
        },
      });
    } finally {
      console.log = origLog;
    }
    const success = lines.find((l) => l.includes("added"));
    expect(success).toBeDefined();
    expect(success).toContain("Confluence page knowledge source");
  });
});
