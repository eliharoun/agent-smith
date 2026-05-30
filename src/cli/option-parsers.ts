import { InvalidArgumentError } from "commander";

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
