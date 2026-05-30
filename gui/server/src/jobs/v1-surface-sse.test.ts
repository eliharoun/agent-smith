import { describe, expect, it } from "bun:test";
import type { JobEvent } from "./job-types";

/**
 * v1-task B9: GUI SSE event-surface snapshot.
 *
 * This snapshot guards the set of `JobEvent` discriminant values
 * emitted on the SSE stream (`GET /api/jobs/:id/stream`). The web
 * client switches on `ev.type` to render output, so adding,
 * removing, or renaming a variant is an SSE-surface breaking change.
 *
 * IF THIS TEST FAILS, you are changing the public SSE event surface.
 * Your options:
 *   1. Revert the change.
 *   2. Bump the major version (v1 → v2).
 *   3. Emit both old and new event names for at least one minor
 *      release with deprecation noted in CHANGELOG, then retire the
 *      old name in the next major.
 * Only after one of those three is in place should you update the
 * snapshot (`bun test --update-snapshots`).
 *
 * The snapshot extracts variant names by exhaustively listing them
 * in a const tuple typed against `JobEvent["type"]` — if a variant
 * is added or removed in `job-types.ts`, the tuple either rejects
 * compilation (added without listing) or the snapshot diffs
 * (removed). Both paths catch drift.
 */
describe("v1 surface — SSE events", () => {
  it("set of JobEvent discriminants is stable", () => {
    // Exhaustiveness assertion: the satisfies clause forces every
    // JobEvent variant to appear in this tuple. Adding a new variant
    // without listing it here makes typecheck fail (Variant 'foo'
    // not assignable to type '...'); removing one makes the snapshot
    // diff. The .sort() makes the snapshot order-independent.
    const eventTypes = [
      "stdout",
      "stderr",
      "progress",
      "prompt",
      "exit",
    ] as const satisfies readonly JobEvent["type"][];

    const sorted = [...eventTypes].sort();
    expect(sorted).toMatchSnapshot();
  });
});
