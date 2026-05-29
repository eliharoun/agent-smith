import { describe, expect, it } from "bun:test";
import { createApp } from "./app";

/**
 * v1-task B9: GUI REST surface snapshot.
 *
 * This snapshot guards the public REST surface as part of the v1
 * contract. The inventory is a sorted list of "METHOD PATH" pairs
 * extracted from the Hono router after createApp() has registered
 * every route module.
 *
 * IF THIS TEST FAILS, you are changing the public REST surface.
 * Your options:
 *   1. Revert the change.
 *   2. Bump the major version (v1 → v2).
 *   3. Add a deprecation header on the removed/renamed route and
 *      keep both shapes live for at least one minor release before
 *      retiring the old one.
 * Only after one of those three is in place should you update the
 * snapshot (`bun test --update-snapshots`).
 *
 * The `/api/__boom` and `ALL /api/*` entries are infrastructure
 * (test-only error route + auth middleware mount) and are excluded
 * from the snapshot so non-surface noise doesn't trigger drift.
 */
describe("v1 surface — REST", () => {
  it("inventory of registered routes is stable", () => {
    const app = createApp({ token: "snapshot-token" });
    // Hono exposes registered routes via the `routes` field. Each
    // entry is { method, path, handler }; we only need method + path.
    const raw = (app as unknown as { routes: { method: string; path: string }[] }).routes;
    const surface = raw
      .filter((r) => r.path.startsWith("/api"))
      // Exclude infra entries — see file header for rationale.
      .filter((r) => r.path !== "/api/*")
      .filter((r) => r.path !== "/api/__boom")
      .map((r) => `${r.method.padEnd(7)} ${r.path}`)
      .sort();
    expect(surface).toMatchSnapshot();
  });
});
