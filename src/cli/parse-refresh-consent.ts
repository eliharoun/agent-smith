import { PLATFORM_IDS, type PlatformId } from "../io/platform-detect";
import { SmithError } from "../core/smith-error";

export type RefreshConsentParsed =
  | { kind: "scalar"; value: "yes" | "no" }
  | { kind: "perPlatform"; value: Partial<Record<PlatformId, "yes" | "no">> };

function normalizeYn(raw: string): "yes" | "no" | null {
  const v = raw.toLowerCase();
  if (v === "y" || v === "yes") return "yes";
  if (v === "n" || v === "no") return "no";
  return null;
}

/**
 * Parse the value of `--refresh-consent`. Accepts either:
 *   - scalar `yes|no` (case-insensitive, with `y`/`n` aliases); or
 *   - per-platform CSV: `name=yn[,name=yn]*` where `name` is one of
 *     {@link PLATFORM_IDS} and `yn` matches the scalar grammar.
 *
 * Returns `undefined` when input is `undefined`. Throws `SmithError`
 * with `code: "usage-error"` on any parse failure.
 */
export function parseRefreshConsent(
  input: string | undefined,
): RefreshConsentParsed | undefined {
  if (input === undefined) return undefined;
  if (input.length === 0) {
    throw new SmithError({
      code: "usage-error",
      message: `invalid value for --refresh-consent: '' (expected yes|no or name=yn,name=yn)`,
    });
  }

  if (!input.includes("=")) {
    const yn = normalizeYn(input);
    if (yn === null) {
      throw new SmithError({
        code: "usage-error",
        message: `invalid value for --refresh-consent: '${input}' (expected yes|no or name=yn,name=yn)`,
      });
    }
    return { kind: "scalar", value: yn };
  }

  const value: Partial<Record<PlatformId, "yes" | "no">> = {};
  const pairs = input.split(",");
  for (const pair of pairs) {
    if (!pair.includes("=")) {
      throw new SmithError({
        code: "usage-error",
        message: `invalid value for --refresh-consent: '${input}' (expected yes|no or name=yn,name=yn)`,
      });
    }
    const [rawPlatform = "", rawYn = ""] = pair.split("=", 2);
    const platform = rawPlatform.trim();
    if (!(PLATFORM_IDS as readonly string[]).includes(platform)) {
      throw new SmithError({
        code: "usage-error",
        message: `unknown platform '${platform}' in --refresh-consent (expected one of: ${PLATFORM_IDS.join(", ")})`,
      });
    }
    const yn = normalizeYn(rawYn.trim());
    if (yn === null) {
      throw new SmithError({
        code: "usage-error",
        message: `invalid value '${rawYn}' for platform '${platform}' in --refresh-consent (expected yes|no)`,
      });
    }
    value[platform as PlatformId] = yn;
  }
  return { kind: "perPlatform", value };
}

/**
 * v1-task B1: resolve the install-time refresh-consent decision by
 * combining the explicit `--refresh-consent` flag with the umbrella
 * `--yes` flag, with the explicit flag winning.
 *
 * The action handler for `agent install` and `agent install-all`
 * previously cascaded `--yes` only into `skillMode = "with-skills"`
 * but did NOT cascade it into refresh-hook consent — so `--yes` in
 * CI still produced a non-TTY warning ("refresh-hook consent skipped")
 * instead of opting in. This helper centralizes the cascade so the
 * precedence is testable and consistent across both install verbs.
 *
 * Precedence (highest wins):
 *   1. `explicit` (the parsed value of `--refresh-consent`)
 *   2. `yes` (umbrella flag) → uniform scalar "yes"
 *   3. neither → undefined (fall through to prompt/non-TTY default)
 */
export function resolveInstallRefreshConsent(
  opts: { yes?: boolean | undefined; explicit?: RefreshConsentParsed | undefined },
): RefreshConsentParsed | undefined {
  if (opts.explicit !== undefined) return opts.explicit;
  if (opts.yes) return { kind: "scalar", value: "yes" };
  return undefined;
}
