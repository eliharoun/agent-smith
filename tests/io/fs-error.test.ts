import { describe, it, expect } from "bun:test";
import { classifyFsError } from "../../src/io/fs-error";

function fsErr(code: string, message: string = ""): Error {
  const e = new Error(message) as NodeJS.ErrnoException;
  e.code = code;
  return e;
}

describe("classifyFsError", () => {
  it("ENOENT → not-found with path + operation", () => {
    const err = classifyFsError(fsErr("ENOENT"), "/tmp/missing", "load bundle");
    expect(err.payload.code).toBe("not-found");
    if (err.payload.code === "not-found") {
      expect(err.payload.what).toBe("load bundle");
      expect(err.payload.identifier).toBe("/tmp/missing");
    }
  });

  it("EACCES → permission-denied (read)", () => {
    const err = classifyFsError(fsErr("EACCES"), "/tmp/x", "load bundle");
    expect(err.payload.code).toBe("permission-denied");
    if (err.payload.code === "permission-denied") {
      expect(err.payload.path).toBe("/tmp/x");
      expect(err.payload.operation).toBe("read");
    }
  });

  it("EPERM → permission-denied", () => {
    const err = classifyFsError(fsErr("EPERM"), "/tmp/x", "load bundle");
    expect(err.payload.code).toBe("permission-denied");
  });

  it("generic Error → validation-failed with path + message in reason", () => {
    const err = classifyFsError(new Error("disk full"), "/tmp/x", "load bundle");
    expect(err.payload.code).toBe("validation-failed");
    if (err.payload.code === "validation-failed") {
      expect(err.payload.what).toBe("load bundle");
      expect(err.payload.reasons[0]).toContain("/tmp/x");
      expect(err.payload.reasons[0]).toContain("disk full");
    }
  });

  it("non-Error input → validation-failed with stringified value", () => {
    const err = classifyFsError("nope", "/tmp/x", "load bundle");
    expect(err.payload.code).toBe("validation-failed");
    if (err.payload.code === "validation-failed") {
      expect(err.payload.reasons[0]).toContain("nope");
    }
  });
});
