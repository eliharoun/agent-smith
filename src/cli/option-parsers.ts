import { InvalidArgumentError } from "commander";
import { CREDENTIAL_KEY_DENYLIST } from "../core/knowledge/schema";
import { SmithError } from "../core/smith-error";

/** Commander option parser that requires an integer (positive or zero). */
export function intArg(name: string): (v: string) => number {
  return (v: string) => {
    const trimmed = v.trim();
    const n = Number.parseInt(trimmed, 10);
    if (Number.isNaN(n) || !Number.isFinite(n) || String(n) !== trimmed) {
      throw new InvalidArgumentError(`${name} must be an integer (got "${v}").`);
    }
    return n;
  };
}

/** Commander option parser for repeatable string flags (e.g. --include <glob>). */
export function collectRepeatable(value: string, prev: string[]): string[] {
  return [...prev, value];
}

/** Commander option parser for repeatable key=value flags (e.g. --arg k=v). */
export function collectKv(pair: string, prev: Record<string, string>): Record<string, string> {
  const i = pair.indexOf("=");
  if (i < 0) throw new SmithError({ code: "usage-error", message: `--arg expects k=v, got '${pair}'` });
  const key = pair.slice(0, i);
  if (CREDENTIAL_KEY_DENYLIST.test(key)) {
    throw new SmithError({ code: "usage-error", message: `--arg key '${key}' looks credential-shaped; use the MCP server's own auth.` });
  }
  return { ...prev, [key]: pair.slice(i + 1) };
}
