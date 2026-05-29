import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { KnowledgeSource } from "./knowledge";

const FIXTURES = join(import.meta.dir, "../../test/fixtures/knowledge-sources");

describe("knowledge schema parity with CLI", () => {
  const files = readdirSync(FIXTURES).filter((f) => f.endsWith(".json"));
  it.each(files)("accepts fixture %s", (file) => {
    const raw = JSON.parse(readFileSync(join(FIXTURES, file), "utf8"));
    const result = KnowledgeSource.safeParse(raw);
    if (!result.success) {
      throw new Error(`${file}: ${JSON.stringify(result.error.format(), null, 2)}`);
    }
    expect(result.success).toBe(true);
  });
});
