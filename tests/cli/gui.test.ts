import { describe, expect, it } from "bun:test";
import { buildGuiArgs, generateToken } from "../../src/cli/commands/gui";

describe("smith gui argv builder", () => {
  it("defaults port to 7777 and bind to 127.0.0.1", () => {
    const args = buildGuiArgs({});
    expect(args.port).toBe(7777);
    expect(args.bind).toBe("127.0.0.1");
    expect(args.open).toBe(true);
  });

  it("respects --port, --bind, --no-open", () => {
    const args = buildGuiArgs({ port: 9000, bind: "0.0.0.0", open: false });
    expect(args).toEqual({ port: 9000, bind: "0.0.0.0", open: false });
  });

  it("currently permits non-localhost bind (safety covered by docs)", () => {
    expect(() => buildGuiArgs({ bind: "0.0.0.0" })).not.toThrow();
  });
});

describe("generateToken", () => {
  it("returns a 32-char hex string", () => {
    const t = generateToken();
    expect(t).toMatch(/^[0-9a-f]{32}$/);
  });

  it("returns a different token each call", () => {
    expect(generateToken()).not.toBe(generateToken());
  });
});
