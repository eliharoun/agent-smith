// gui/server/src/jobs/argv-builders/v1-job-kinds.test.ts
//
// C4.2.7 (v1-task) + B9 surface lock: snapshots the full JobRequest
// discriminated-union command list. Locks additive-only growth so any
// rename or removal trips the test and forces an explicit decision +
// CHANGELOG entry. C-series additions (agent.sync, skill.sync) are
// baked into the initial snapshot.
//
// The literal extractor walks both bare z.object members and refined
// (z.object().refine()) members; the latter wrap shape in _def.innerType.

import { describe, expect, it } from "bun:test";
import { JobRequest } from "gui-shared";

function extractCommandLiteral(opt: unknown): string {
  const o = opt as {
    shape?: { command?: { value?: string; _def?: { value?: string } } };
    _def?: {
      innerType?: {
        shape?: { command?: { value?: string; _def?: { value?: string } } };
      };
    };
  };
  const inner = o.shape?.command ?? o._def?.innerType?.shape?.command;
  const v = inner?.value ?? inner?._def?.value;
  if (typeof v !== "string") throw new Error("could not extract command literal");
  return v;
}

describe("v1 JobRequest command union snapshot (B9 + C4.2.7)", () => {
  it("includes exactly the documented commands (additive-only growth lock)", () => {
    const commands = JobRequest.options.map(extractCommandLiteral).sort();
    expect(commands).toMatchInlineSnapshot(`
[
  "agent.catalog-rename",
  "agent.catalogs",
  "agent.destroy",
  "agent.export",
  "agent.init",
  "agent.install",
  "agent.install-all",
  "agent.list",
  "agent.reconfigure",
  "agent.register",
  "agent.sync",
  "agent.uninstall",
  "agent.uninstall-all",
  "agent.unregister",
  "agent.validate",
  "daemon.start",
  "daemon.stop",
  "doctor",
  "init",
  "init-user",
  "jack-out",
  "knowledge.add",
  "knowledge.compile",
  "knowledge.fetch",
  "knowledge.list",
  "knowledge.migrate-codex",
  "knowledge.remove",
  "knowledge.serve",
  "knowledge.validate",
  "skill.bootstrap",
  "skill.catalog-rename",
  "skill.catalogs",
  "skill.install",
  "skill.list",
  "skill.register",
  "skill.sync",
  "skill.uninstall",
  "skill.unregister",
  "skill.update",
  "skill.validate",
  "status",
  "update",
]
`);
  });
});
