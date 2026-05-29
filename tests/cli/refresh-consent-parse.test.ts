import { describe, expect, it } from "bun:test";
import {
  parseRefreshConsent,
  resolveInstallRefreshConsent,
} from "../../src/cli/parse-refresh-consent";

describe("parseRefreshConsent", () => {
  it("returns undefined when input is undefined", () => {
    expect(parseRefreshConsent(undefined)).toBeUndefined();
  });

  it("parses scalar yes", () => {
    expect(parseRefreshConsent("yes")).toEqual({ kind: "scalar", value: "yes" });
  });

  it("parses scalar y", () => {
    expect(parseRefreshConsent("y")).toEqual({ kind: "scalar", value: "yes" });
  });

  it("parses scalar no", () => {
    expect(parseRefreshConsent("no")).toEqual({ kind: "scalar", value: "no" });
  });

  it("parses scalar n", () => {
    expect(parseRefreshConsent("n")).toEqual({ kind: "scalar", value: "no" });
  });

  it("is case-insensitive for scalar", () => {
    expect(parseRefreshConsent("YES")).toEqual({ kind: "scalar", value: "yes" });
  });

  it("parses single per-platform pair", () => {
    expect(parseRefreshConsent("opencode=yes")).toEqual({
      kind: "perPlatform",
      value: { opencode: "yes" },
    });
  });

  it("parses multiple per-platform pairs", () => {
    expect(parseRefreshConsent("opencode=yes,claude-code=no,codex=y")).toEqual({
      kind: "perPlatform",
      value: { opencode: "yes", "claude-code": "no", codex: "yes" },
    });
  });

  it("throws on empty string", () => {
    expect(() => parseRefreshConsent("")).toThrow(
      /invalid value for --refresh-consent/,
    );
  });

  it("throws on invalid scalar", () => {
    expect(() => parseRefreshConsent("maybe")).toThrow(
      /invalid value for --refresh-consent: 'maybe' \(expected yes\|no/,
    );
  });

  it("throws on unknown platform in CSV", () => {
    expect(() => parseRefreshConsent("bogus=yes")).toThrow(
      /unknown platform 'bogus'/,
    );
  });

  it("throws on invalid value in CSV", () => {
    expect(() => parseRefreshConsent("opencode=maybe")).toThrow(
      /invalid value 'maybe' for platform 'opencode'/,
    );
  });

  it("throws on malformed pair (no equals)", () => {
    expect(() => parseRefreshConsent("opencode")).toThrow(
      /invalid value for --refresh-consent/,
    );
  });

  it("throws on mixed CSV with malformed pair", () => {
    expect(() => parseRefreshConsent("opencode=yes,bare")).toThrow(
      /invalid value for --refresh-consent/,
    );
  });
});

/**
 * v1-task B1: --yes cascade for refresh consent.
 *
 * Today the `agent install` command treats `--yes` as auto-accept for
 * required-skill prompts but NOT for refresh-hook consent prompts —
 * meaning `--yes` in CI still hangs (in TTY) or warns (non-TTY) on
 * refresh hooks. resolveInstallRefreshConsent centralizes the cascade
 * so the action handler stays one line and the precedence is testable.
 *
 * Precedence (highest wins):
 *   1. explicit --refresh-consent (returned as-is by parseRefreshConsent)
 *   2. --yes => scalar yes (uniform across platforms)
 *   3. neither => undefined (fall through to prompt/non-TTY default)
 */
describe("resolveInstallRefreshConsent — --yes cascade (v1-task B1)", () => {
  it("returns undefined when neither --yes nor --refresh-consent set", () => {
    expect(resolveInstallRefreshConsent({})).toBeUndefined();
  });

  it("maps --yes to scalar yes when --refresh-consent not set", () => {
    expect(resolveInstallRefreshConsent({ yes: true })).toEqual({
      kind: "scalar",
      value: "yes",
    });
  });

  it("explicit --refresh-consent wins over --yes (scalar no)", () => {
    // The user said --yes but ALSO --refresh-consent no. The explicit
    // refresh flag is more specific and must win — otherwise --yes
    // silently overrides a deliberate opt-out.
    const explicit = parseRefreshConsent("no");
    expect(resolveInstallRefreshConsent({ yes: true, explicit })).toEqual(explicit);
  });

  it("explicit --refresh-consent wins over --yes (per-platform)", () => {
    const explicit = parseRefreshConsent("opencode=no,codex=yes");
    expect(resolveInstallRefreshConsent({ yes: true, explicit })).toEqual(explicit);
  });

  it("yes=false and no explicit returns undefined", () => {
    expect(resolveInstallRefreshConsent({ yes: false })).toBeUndefined();
  });
});
