import { describe, expect, it } from "bun:test";
import { smithBinaryPath } from "./smith-binary";

describe("smithBinaryPath", () => {
  it("prefers SMITH_BIN env var when set", () => {
    const prev = process.env.SMITH_BIN;
    process.env.SMITH_BIN = "/custom/smith";
    try {
      expect(smithBinaryPath()).toBe("/custom/smith");
    } finally {
      if (prev === undefined) delete process.env.SMITH_BIN;
      else process.env.SMITH_BIN = prev;
    }
  });

  it("falls back to 'smith' on PATH", () => {
    const prev = process.env.SMITH_BIN;
    delete process.env.SMITH_BIN;
    try {
      expect(smithBinaryPath()).toBe("smith");
    } finally {
      if (prev !== undefined) process.env.SMITH_BIN = prev;
    }
  });
});
