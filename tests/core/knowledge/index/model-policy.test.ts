import { describe, expect, test } from "bun:test";
import { CODE_MODEL, MODEL_POLICY_VERSION, TEXT_MODEL, modelForKind, roleForModelId } from "../../../../src/core/knowledge/index/model-policy";

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
  test("each model's id is `${modelId}@1` — matches what loadEmbedder stamps, so the embedder_id partition lines up", () => {
    // loadEmbedder returns `${modelId}@1`; if ModelRef.id drifts from that, the
    // serve query (searchVector by embedder_id) would never match stored rows.
    expect(CODE_MODEL.id).toBe(`${CODE_MODEL.modelId}@1`);
    expect(TEXT_MODEL.id).toBe(`${TEXT_MODEL.modelId}@1`);
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

describe("MODEL_POLICY_VERSION", () => {
  test("MODEL_POLICY_VERSION is a positive integer", () => {
    expect(Number.isInteger(MODEL_POLICY_VERSION)).toBe(true);
    expect(MODEL_POLICY_VERSION).toBeGreaterThan(0);
  });
});
