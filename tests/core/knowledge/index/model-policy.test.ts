import { describe, expect, test } from "bun:test";
import { CODE_MODEL, TEXT_MODEL, modelForKind } from "../../../../src/core/knowledge/index/model-policy";

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
