import { describe, expect, test } from "bun:test";
import { collectKv, collectRepeatable } from "../../src/cli/option-parsers";

describe("collectRepeatable", () => {
  test("accumulates values", () => {
    let acc: string[] = [];
    acc = collectRepeatable("a", acc);
    acc = collectRepeatable("b", acc);
    expect(acc).toEqual(["a", "b"]);
  });
});

describe("collectKv", () => {
  test("parses k=v", () => {
    expect(collectKv("foo=bar", {})).toEqual({ foo: "bar" });
  });

  test("handles empty value (k=)", () => {
    expect(collectKv("key=", {})).toEqual({ key: "" });
  });

  test("value keeps the rest (k=a=b)", () => {
    expect(collectKv("key=a=b", {})).toEqual({ key: "a=b" });
  });

  test("throws on missing =", () => {
    expect(() => collectKv("noequals", {})).toThrow("--arg expects k=v");
  });

  test("rejects access_token", () => {
    expect(() => collectKv("access_token=x", {})).toThrow("credential-shaped");
  });

  test("rejects client_secret", () => {
    expect(() => collectKv("client_secret=x", {})).toThrow("credential-shaped");
  });

  test("rejects api_key", () => {
    expect(() => collectKv("api_key=x", {})).toThrow("credential-shaped");
  });

  test("rejects password", () => {
    expect(() => collectKv("password=x", {})).toThrow("credential-shaped");
  });

  test("rejects authorization", () => {
    expect(() => collectKv("authorization=x", {})).toThrow("credential-shaped");
  });

  test("rejects bearer", () => {
    expect(() => collectKv("bearer=x", {})).toThrow("credential-shaped");
  });

  test("rejects secret", () => {
    expect(() => collectKv("secret=x", {})).toThrow("credential-shaped");
  });

  test("rejects private_key", () => {
    expect(() => collectKv("private_key=x", {})).toThrow("credential-shaped");
  });

  test("allows safe keys", () => {
    expect(collectKv("query=hello", {})).toEqual({ query: "hello" });
    expect(collectKv("page_size=10", {})).toEqual({ page_size: "10" });
  });
});
