import { describe, expect, test } from "bun:test";
import { diffSchemas } from "../../../src/core/freshness/diff";

describe("diffSchemas", () => {
  test("identical schemas → empty diff, headline 'no drift'", () => {
    const schema = { properties: { agent: { type: "object" } } };
    const result = diffSchemas(schema, schema);
    expect(result.added).toEqual([]);
    expect(result.removed).toEqual([]);
    expect(result.changed).toEqual([]);
    expect(result.headline).toBe("no drift");
  });

  test("added field is reported in 'added'", () => {
    const a = { x: 1 };
    const b = { x: 1, y: 2 };
    const result = diffSchemas(a, b);
    expect(result.added).toContain("y");
    expect(result.removed).toEqual([]);
    expect(result.changed).toEqual([]);
    expect(result.headline).toContain("1 added");
  });

  test("removed field is reported in 'removed'", () => {
    const a = { x: 1, y: 2 };
    const b = { x: 1 };
    const result = diffSchemas(a, b);
    expect(result.removed).toContain("y");
  });

  test("changed value is reported in 'changed'", () => {
    const a = { x: 1 };
    const b = { x: 2 };
    const result = diffSchemas(a, b);
    expect(result.changed).toContain("x");
  });

  test("nested paths use slash-separator", () => {
    const a = { properties: { agent: { type: "object" } } };
    const b = { properties: { agent: { type: "object", new: 1 } } };
    const result = diffSchemas(a, b);
    expect(result.added).toContain("properties/agent/new");
  });

  test("array reordering at the same index does NOT register as drift (normalized)", () => {
    const a = { enum: ["a", "b", "c"] };
    const b = { enum: ["c", "a", "b"] };
    const result = diffSchemas(a, b);
    // Sorted-array compare: same set → no drift.
    expect(result.changed).toEqual([]);
    expect(result.added).toEqual([]);
    expect(result.removed).toEqual([]);
  });

  test("object key reordering does NOT register as drift (keys normalized)", () => {
    const a = { a: 1, b: 2 };
    const b = { b: 2, a: 1 };
    const result = diffSchemas(a, b);
    expect(result.headline).toBe("no drift");
    expect(result.added).toEqual([]);
    expect(result.removed).toEqual([]);
    expect(result.changed).toEqual([]);
  });

  test("mixed primitive+object arrays are NOT sorted (order is preserved)", () => {
    // A mixed-content array reordered should register as drift, since allPrimitive is false
    // and the array is left in original order. Reversing 0/1 swaps a CHANGE at both indices.
    const a = { items: [1, { kind: "x" }] };
    const b = { items: [{ kind: "x" }, 1] };
    const result = diffSchemas(a, b);
    // At least one change should register (microdiff sees both indices changed)
    expect(result.added.length + result.removed.length + result.changed.length).toBeGreaterThan(0);
  });

  test("array element added IS drift", () => {
    const a = { enum: ["a", "b"] };
    const b = { enum: ["a", "b", "c"] };
    const result = diffSchemas(a, b);
    // Either "added" or "changed" depending on microdiff's behavior — must be non-empty
    expect(result.added.length + result.changed.length).toBeGreaterThan(0);
  });

  test("headline summarizes counts", () => {
    const a = { x: 1, y: 2 };
    const b = { x: 1, z: 3, w: 4 };
    const result = diffSchemas(a, b);
    expect(result.headline).toMatch(/2 added/);
    expect(result.headline).toMatch(/1 removed/);
  });
});
