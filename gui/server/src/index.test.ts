import { describe, expect, it } from "bun:test";
import { displayHost } from "./index";

describe("displayHost", () => {
  it("returns the bind unchanged for loopback IPv4", () => {
    expect(displayHost("127.0.0.1")).toBe("127.0.0.1");
  });

  it("rewrites 0.0.0.0 to 127.0.0.1 (browsers refuse 0.0.0.0)", () => {
    expect(displayHost("0.0.0.0")).toBe("127.0.0.1");
  });

  it("rewrites :: to 127.0.0.1", () => {
    expect(displayHost("::")).toBe("127.0.0.1");
  });

  it("rewrites ::0 to 127.0.0.1", () => {
    expect(displayHost("::0")).toBe("127.0.0.1");
  });

  it("returns 'localhost' unchanged", () => {
    expect(displayHost("localhost")).toBe("localhost");
  });

  it("returns specific bind addresses unchanged", () => {
    expect(displayHost("192.168.1.10")).toBe("192.168.1.10");
  });
});
