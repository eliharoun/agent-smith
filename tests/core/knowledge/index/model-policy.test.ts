import { describe, expect, test } from "bun:test";
import { CODE_MODEL, TEXT_MODEL, modelForKind, roleForModelId } from "../../../../src/core/knowledge/index/model-policy";

describe("modelForKind", () => {
  test("code -> code model", () => {
    expect(modelForKind("code")).toEqual(CODE_MODEL);
  });
  test("prose -> text model", () => {
    expect(modelForKind("prose")).toEqual(TEXT_MODEL);
  });
  test("json -> text model", () => {
    expect(modelForKind("json")).toEqual(TEXT_MODEL);
  });
  test("models have distinct ids and both are 768-dim", () => {
    expect(CODE_MODEL.id).not.toBe(TEXT_MODEL.id);
    expect(CODE_MODEL.dim).toBe(768);
    expect(TEXT_MODEL.dim).toBe(768);
  });
});

describe("roleForModelId", () => {
  test("code model id -> 'code'", () => {
    expect(roleForModelId(CODE_MODEL.id)).toBe("code");
  });
  test("text model id -> 'prose'", () => {
    expect(roleForModelId(TEXT_MODEL.id)).toBe("prose");
  });
  test("unknown id falls back to the id itself", () => {
    expect(roleForModelId("weird@9")).toBe("weird@9");
  });
});
