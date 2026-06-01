import { describe, expect, it, test } from "bun:test";
import { assembleBody } from "../../src/core/assembler";

describe("core/assembler", () => {
  test("concatenates all four files in IDENTITY -> EXPERTISE -> SOUL -> USER order", () => {
    const body = assembleBody({
      identity: "I_BLOCK",
      expertise: "E_BLOCK",
      soul: "S_BLOCK",
      user: "U_BLOCK",
    });
    const iIdx = body.indexOf("I_BLOCK");
    const eIdx = body.indexOf("E_BLOCK");
    const sIdx = body.indexOf("S_BLOCK");
    const uIdx = body.indexOf("U_BLOCK");
    expect(iIdx).toBeGreaterThanOrEqual(0);
    expect(iIdx).toBeLessThan(eIdx);
    expect(eIdx).toBeLessThan(sIdx);
    expect(sIdx).toBeLessThan(uIdx);
  });

  test("trims trailing whitespace from each block before joining", () => {
    const body = assembleBody({
      identity: "A\n\n\n",
      expertise: "B\n\n",
      soul: "C\n",
      user: "D",
    });
    // No triple-newlines should appear inside the assembled body
    expect(body).not.toMatch(/\n{3,}/);
  });

  test("includes section delimiters so model can distinguish blocks", () => {
    const body = assembleBody({
      identity: "i",
      expertise: "e",
      soul: "s",
      user: "u",
    });
    // We use markdown HR `---` as the delimiter
    const hrCount = (body.match(/^---$/gm) ?? []).length;
    expect(hrCount).toBe(3);
  });

  test("output ends with a single trailing newline", () => {
    const body = assembleBody({
      identity: "i",
      expertise: "e",
      soul: "s",
      user: "u",
    });
    expect(body.endsWith("\n")).toBe(true);
    expect(body.endsWith("\n\n")).toBe(false);
  });

  test("strips frontmatter accidentally present in any file", () => {
    const body = assembleBody({
      identity: "---\ndescription: x\n---\nReal identity content",
      expertise: "Real expertise",
      soul: "Real soul",
      user: "Real user",
    });
    expect(body).not.toContain("description: x");
    expect(body).toContain("Real identity content");
  });
});

describe("assembleBody with knowledge", () => {
  const base = { identity: "I", expertise: "E", soul: "S", user: "U" };

  test("renders no Knowledge section when knowledge is undefined", () => {
    const out = assembleBody(base);
    expect(out).not.toContain("## Knowledge");
    expect(out).not.toContain("## Knowledge Index");
  });

  test("renders an inline Knowledge section after USER and before SKILLS", () => {
    const out = assembleBody(base, undefined, {
      inline: [{ id: "schema", description: "Database schema", content: "select 1;" }],
      index: [],
    });
    expect(out).toContain("## Knowledge");
    expect(out).toContain("### schema — Database schema");
    expect(out).toContain("select 1;");
    // KNOWLEDGE comes after USER
    expect(out.indexOf("U")).toBeLessThan(out.indexOf("## Knowledge"));
  });

  test("renders a Knowledge Index section for file-mode sources", () => {
    const out = assembleBody(base, undefined, {
      inline: [],
      index: [
        {
          id: "rb",
          relPath: "sources/rb/deploy.md",
          description: "Deploy",
          summary: "Deploy steps",
        },
      ],
    });
    expect(out).toContain("## Knowledge Index");
    expect(out).toContain("- sources/rb/deploy.md — Deploy steps");
  });

  test("Knowledge Index preamble includes the absolute rootDir when provided so the agent does not have to guess where the files live", () => {
    const out = assembleBody(base, undefined, {
      inline: [],
      index: [{ id: "rb", relPath: "sources/rb/deploy.md", summary: "Deploy" }],
      rootDir: "/Users/test/.config/agent-smith/knowledge/my-agent",
    });
    expect(out).toContain("/Users/test/.config/agent-smith/knowledge/my-agent");
    // Bullet path stays relative so it's easy to read; absolute root is in preamble
    expect(out).toContain("- sources/rb/deploy.md");
  });

  test("Knowledge Index renders without rootDir (back-compat) but omits the absolute-path hint", () => {
    const out = assembleBody(base, undefined, {
      inline: [],
      index: [{ id: "rb", relPath: "sources/rb/deploy.md" }],
    });
    expect(out).toContain("## Knowledge Index");
    // No absolute path in preamble
    expect(out).not.toContain("/Users/");
  });

  test("Knowledge Index preamble includes the repos/<source-id> hint when hasGitSources is true and rootDir is provided", () => {
    const out = assembleBody(base, undefined, {
      inline: [],
      index: [{ id: "rb", relPath: "sources/rb/deploy.md", summary: "Deploy" }],
      rootDir: "/Users/test/.config/agent-smith/knowledge/my-agent",
      hasGitSources: true,
    });
    expect(out).toContain("repos/<source-id>");
    expect(out).toContain("full repository");
  });

  test("Knowledge Index preamble OMITS the repos hint when hasGitSources is false (back-compat: byte-identical to omitting the flag)", () => {
    const outWithFlag = assembleBody(base, undefined, {
      inline: [],
      index: [{ id: "rb", relPath: "sources/rb/deploy.md", summary: "Deploy" }],
      rootDir: "/Users/test/.config/agent-smith/knowledge/my-agent",
      hasGitSources: false,
    });
    const outWithoutFlag = assembleBody(base, undefined, {
      inline: [],
      index: [{ id: "rb", relPath: "sources/rb/deploy.md", summary: "Deploy" }],
      rootDir: "/Users/test/.config/agent-smith/knowledge/my-agent",
    });
    expect(outWithFlag).toBe(outWithoutFlag);
    expect(outWithFlag).not.toContain("repos/<source-id>");
  });

  test("Knowledge Index preamble OMITS the repos hint when hasGitSources is true but rootDir is missing (no path to substitute)", () => {
    const out = assembleBody(base, undefined, {
      inline: [],
      index: [{ id: "rb", relPath: "sources/rb/deploy.md" }],
      hasGitSources: true,
    });
    expect(out).not.toContain("repos/<source-id>");
  });

  test("renders both sections when both inline and index are populated, with skills coming after", () => {
    const out = assembleBody(
      base,
      { skills: ["my-skill"], descriptions: new Map([["my-skill", "Does things"]]) },
      {
        inline: [{ id: "x", content: "inline body" }],
        index: [{ id: "y", relPath: "sources/y/a.md", summary: "A" }],
      },
    );
    const kIdx = out.indexOf("## Knowledge");
    const kxIdx = out.indexOf("## Knowledge Index");
    const sIdx = out.indexOf("## Default Skills");
    expect(kIdx).toBeGreaterThan(0);
    expect(kxIdx).toBeGreaterThan(kIdx);
    expect(sIdx).toBeGreaterThan(kxIdx);
  });
});

describe("assembleBody Knowledge Discipline section", () => {
  const base = { identity: "I", expertise: "E", soul: "S", user: "U" };

  test("renders a Knowledge Discipline section whenever a Knowledge Index is rendered", () => {
    const out = assembleBody(base, undefined, {
      inline: [],
      index: [{ id: "rb", relPath: "sources/rb/deploy.md", summary: "Deploy" }],
    });
    expect(out).toContain("## Knowledge Discipline");
  });

  test("Knowledge Discipline appears AFTER inline Knowledge and BEFORE the Knowledge Index", () => {
    const out = assembleBody(base, undefined, {
      inline: [{ id: "x", content: "inline body" }],
      index: [{ id: "y", relPath: "sources/y/a.md", summary: "A" }],
    });
    const kIdx = out.indexOf("## Knowledge\n");
    const dIdx = out.indexOf("## Knowledge Discipline");
    const xIdx = out.indexOf("## Knowledge Index");
    expect(kIdx).toBeGreaterThan(0);
    expect(dIdx).toBeGreaterThan(kIdx);
    expect(xIdx).toBeGreaterThan(dIdx);
  });

  test("Knowledge Discipline interpolates the literal rootDir when one is provided", () => {
    const root = "/Users/test/.config/agent-smith/knowledge/my-agent";
    const out = assembleBody(base, undefined, {
      inline: [],
      index: [{ id: "rb", relPath: "sources/rb/deploy.md", summary: "Deploy" }],
      rootDir: root,
    });
    // The discipline block names the root path so models read the EXACT prefix to use
    const disciplineHeading = "## Knowledge Discipline";
    const indexHeading = "## Knowledge Index";
    const dStart = out.indexOf(disciplineHeading);
    const xStart = out.indexOf(indexHeading);
    expect(dStart).toBeGreaterThan(0);
    expect(xStart).toBeGreaterThan(dStart);
    const disciplineBlock = out.slice(dStart, xStart);
    expect(disciplineBlock).toContain(root);
  });

  test("Knowledge Discipline names the canonical path shape so models cannot invent flat paths", () => {
    const out = assembleBody(base, undefined, {
      inline: [],
      index: [{ id: "rb", relPath: "sources/rb/deploy.md", summary: "Deploy" }],
    });
    expect(out).toContain("sources/<source-id>/<page-id>-<slug>.md");
  });

  test("Knowledge Discipline forbids reconstructing paths from memory in plain terms", () => {
    const out = assembleBody(base, undefined, {
      inline: [],
      index: [{ id: "rb", relPath: "sources/rb/deploy.md" }],
    });
    // Single substring drawn from the rule prose; if the wording is edited, this assertion
    // and the spec doc both must be updated in lockstep.
    expect(out.toLowerCase()).toContain("never reconstruct");
  });

  test("Knowledge Discipline is OMITTED when the agent has only inline knowledge (no file-delivery sources)", () => {
    const out = assembleBody(base, undefined, {
      inline: [{ id: "x", content: "inline body" }],
      index: [],
    });
    expect(out).toContain("## Knowledge\n");
    expect(out).not.toContain("## Knowledge Discipline");
    expect(out).not.toContain("## Knowledge Index");
  });

  test("Knowledge Discipline is OMITTED when the agent has no knowledge at all", () => {
    const out = assembleBody(base);
    expect(out).not.toContain("## Knowledge Discipline");
  });

  test("Knowledge Index preamble no longer contains the redundant 'Do not guess the path' sentence (the rule now lives in Discipline)", () => {
    const out = assembleBody(base, undefined, {
      inline: [],
      index: [{ id: "rb", relPath: "sources/rb/deploy.md", summary: "Deploy" }],
      rootDir: "/Users/test/.config/agent-smith/knowledge/my-agent",
    });
    // The literal old sentence is gone. Discipline owns the rule now.
    expect(out).not.toContain("Do not guess the path");
  });

  test("Knowledge Index preamble points the model back at the Knowledge Discipline rules", () => {
    const out = assembleBody(base, undefined, {
      inline: [],
      index: [{ id: "rb", relPath: "sources/rb/deploy.md", summary: "Deploy" }],
      rootDir: "/Users/test/.config/agent-smith/knowledge/my-agent",
    });
    const xIdx = out.indexOf("## Knowledge Index");
    const indexBlock = out.slice(xIdx);
    // The preamble that follows the Knowledge Index heading references the Discipline section above
    expect(indexBlock.toLowerCase()).toContain("knowledge discipline");
  });
});

describe("tool routing policy", () => {
  const baseInput = {
    identity: "I",
    expertise: "E",
    soul: "S",
    user: "U",
  };

  test("omits the policy block when no skills section is given", () => {
    const knowledge = {
      inline: [],
      index: [{ id: "j", relPath: "sources/j/x.md" }],
      sourceTypes: new Set(["jira" as const]),
    };
    const body = assembleBody(baseInput, undefined, knowledge);
    expect(body).not.toContain("Tool Routing Policy");
  });

  test("omits the policy block when no knowledge section is given", () => {
    const skills = {
      skills: ["jira-helper"],
      descriptions: new Map(),
    };
    const body = assembleBody(baseInput, skills, undefined);
    expect(body).not.toContain("Tool Routing Policy");
  });

  test("omits the policy block when jira knowledge present but jira-helper not declared", () => {
    const skills = { skills: ["unrelated-skill"], descriptions: new Map() };
    const knowledge = {
      inline: [],
      index: [{ id: "j", relPath: "sources/j/x.md" }],
      sourceTypes: new Set(["jira" as const]),
    };
    const body = assembleBody(baseInput, skills, knowledge);
    expect(body).not.toContain("Tool Routing Policy");
  });

  test("emits only the matched rule when one signal pair is incomplete", () => {
    const skills = { skills: ["jira-helper"], descriptions: new Map() };
    const knowledge = {
      inline: [],
      index: [
        { id: "j", relPath: "sources/j/x.md" },
        { id: "c", relPath: "sources/c/y.md" },
      ],
      sourceTypes: new Set(["jira" as const, "confluence" as const]),
    };
    const body = assembleBody(baseInput, skills, knowledge);
    expect(body).toContain("jira-helper");
    expect(body).not.toContain("confluence-helper");
  });
});

describe("assembleBody with compiledKnowledge (v2 progressive disclosure)", () => {
  it("uses compiledKnowledge.tocStanza in place of the v1 inline+index when supplied", () => {
    const body = assembleBody(
      { identity: "I", expertise: "E", soul: "S", user: "U" },
      undefined,
      undefined,
      {
        tocStanza: "## Knowledge\n\nCOMPILED-TOC",
        warnings: [],
        manifest: {
          schemaVersion: 1,
          contentHash: "h",
          sources: [],
          totals: { tocLines: 0, sourcesIndexed: 0, sourcesShown: 0 },
        },
      },
    );
    expect(body).toContain("COMPILED-TOC");
    expect(body).not.toContain("## Knowledge Index");
  });
});
