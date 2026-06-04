import { describe, it, expect } from "bun:test";
import { sha256 } from "../../src/io/hash";

describe("sha256", () => {
  it("returns the known sha256 of 'abc'", () => {
    const result = sha256(Buffer.from("abc", "utf8"));
    expect(result).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("returns a 64-character hex string", () => {
    const result = sha256(Buffer.from("hello", "utf8"));
    expect(result).toHaveLength(64);
    expect(result).toMatch(/^[0-9a-f]+$/);
  });

  it("returns different hashes for different inputs", () => {
    expect(sha256(Buffer.from("a"))).not.toBe(sha256(Buffer.from("b")));
  });
});
