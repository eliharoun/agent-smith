import { describe, expect, test } from "bun:test";
import { expandPreset, PRESET_NAMES, PRESETS } from "../../src/core/permission-presets";

describe("core/permission-presets", () => {
  test("PRESET_NAMES is exactly the three expected names in order", () => {
    expect(PRESET_NAMES).toEqual(["read-only", "read-edit", "full"]);
  });

  test("expandPreset('read-only') returns the read-only preset shape", () => {
    const expected = {
      read: "allow",
      glob: "allow",
      grep: "allow",
      list: "allow",
      lsp: "allow",
      edit: "deny",
      bash: "deny",
      task: "deny",
      webfetch: "deny",
      websearch: "deny",
      external_directory: "deny",
      skill: "allow",
    } as const;
    expect(expandPreset("read-only")).toEqual(expected);
  });

  test("expandPreset('read-edit') overrides edit and task to allow", () => {
    const expected = {
      read: "allow",
      glob: "allow",
      grep: "allow",
      list: "allow",
      lsp: "allow",
      edit: "allow",
      bash: "deny",
      task: "allow",
      webfetch: "deny",
      websearch: "deny",
      external_directory: "deny",
      skill: "allow",
    } as const;
    const result = expandPreset("read-edit");
    expect(result).toEqual(expected);
    expect(result.edit).toBe("allow");
    expect(result.task).toBe("allow");
  });

  test("expandPreset('full') sets every group to allow", () => {
    const expected = {
      read: "allow",
      glob: "allow",
      grep: "allow",
      list: "allow",
      lsp: "allow",
      edit: "allow",
      bash: "allow",
      task: "allow",
      webfetch: "allow",
      websearch: "allow",
      external_directory: "allow",
      skill: "allow",
    } as const;
    const result = expandPreset("full");
    expect(result).toEqual(expected);
    for (const value of Object.values(result)) {
      expect(value).toBe("allow");
    }
  });

  test("expandPreset returns a deep clone — mutations don't leak into PRESETS", () => {
    const result = expandPreset("read-only");
    result.read = "deny";
    const result2 = expandPreset("read-only");
    expect(result2.read).toBe("allow");
    expect(PRESETS["read-only"].read).toBe("allow");
  });

  test("expandPreset throws on unknown preset name", () => {
    expect(() => expandPreset("bogus" as never)).toThrow(/Unknown permission preset.*bogus/);
  });
});
