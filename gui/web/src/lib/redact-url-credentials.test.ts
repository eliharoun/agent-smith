import { describe, expect, it } from "vitest";
import { redactUrlCredentials } from "./redact-url-credentials";

describe("redactUrlCredentials (C4.4.2)", () => {
  it("redacts user:pass in https URL", () => {
    expect(redactUrlCredentials("Cloning from https://alice:secret@h/o/r.git…")).toBe(
      "Cloning from https://***@h/o/r.git…",
    );
  });

  it("leaves token-without-scheme alone (not a URL pattern)", () => {
    expect(redactUrlCredentials("ghp_abc123def@github.com/x/y; OK")).toBe(
      "ghp_abc123def@github.com/x/y; OK",
    );
  });

  it("redacts token-only in https URL", () => {
    expect(redactUrlCredentials("https://ghp_abc123@github.com/x/y")).toBe(
      "https://***@github.com/x/y",
    );
  });

  it("redacts ssh URL with token-style user", () => {
    expect(redactUrlCredentials("ssh://gituser:p4ss@h/o/r")).toBe("ssh://***@h/o/r");
  });

  it("redacts git scheme", () => {
    expect(redactUrlCredentials("git://user:tok@h/o/r")).toBe("git://***@h/o/r");
  });

  it("redacts http scheme (plain http, defense in depth)", () => {
    expect(redactUrlCredentials("http://u:p@h/o/r")).toBe("http://***@h/o/r");
  });

  it("leaves credential-free URL alone", () => {
    expect(redactUrlCredentials("https://github.com/o/r.git")).toBe("https://github.com/o/r.git");
  });

  it("redacts multiple URLs in one line", () => {
    expect(redactUrlCredentials("a https://u:p@h1/r b https://x:y@h2/r")).toBe(
      "a https://***@h1/r b https://***@h2/r",
    );
  });

  it("leaves non-URL text alone", () => {
    expect(redactUrlCredentials("foo bar; not a url")).toBe("foo bar; not a url");
  });

  it("handles empty string", () => {
    expect(redactUrlCredentials("")).toBe("");
  });
});
