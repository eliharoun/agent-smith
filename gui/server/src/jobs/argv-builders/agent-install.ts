import type { BuiltArgv } from "./types";
import { previewOf } from "./types";

interface Req {
  // C4.2.1: name/platforms become optional at the schema level when `from`
  // is set. The CLI's --from flow derives the bundle name from the remote
  // and prompts for platforms via SSE; the GUI passes neither up-front.
  name?: string | undefined;
  platforms: string[];
  withSkills: boolean;
  refreshConsent?: Record<string, "yes" | "no" | "skip"> | undefined;
  from?: string | undefined;
  ref?: string | undefined;
  /** Task 1.5: forward to the CLI's `--force` flag. */
  force?: boolean | undefined;
  // Task 7: multi-select install from external repo
  agents?: string[] | undefined;
  all?: boolean | undefined;
  json?: boolean | undefined;
}

export function buildAgentInstall(req: Req): BuiltArgv {
  // Schema's .refine() guarantees `from` OR (name + ≥1 platform). Defense in
  // depth: assert that here so a payload that bypassed validation still aborts.
  if (!req.from && (!req.name || req.platforms.length === 0)) {
    throw new Error(
      "agent.install requires either `from` OR both `name` and at least one platform",
    );
  }

  // The leading positional is the bundle name. With `--from`, providing
  // a name disambiguates which bundle inside the cloned repo to install;
  // omitting it lets the CLI infer when there's exactly one. For local
  // installs the name is always required (enforced above).
  const argv: string[] = ["agent", "install"];
  if (req.name) argv.push(req.name);
  argv.push("--yes");
  if (req.platforms.length > 0) {
    argv.push("--platforms", req.platforms.join(","));
  }
  if (req.withSkills) argv.push("--with-skills");
  if (req.from) {
    argv.push("--from", req.from);
    if (req.ref) argv.push("--ref", req.ref);
  }
  if (req.refreshConsent) {
    const pairs = Object.entries(req.refreshConsent).filter(([, v]) => v === "yes" || v === "no");
    if (pairs.length > 0) {
      const flat = pairs.map(([p, v]) => `${p}=${v}`).join(",");
      argv.push("--refresh-consent", flat);
    }
  }
  if (req.force) argv.push("--force");
  if (req.json) argv.push("--json");
  if (req.all) argv.push("--all");
  if (req.agents && req.agents.length > 0) {
    const SAFE = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$|^[a-z0-9]$/;
    for (const a of req.agents) if (!SAFE.test(a)) throw new Error(`agent.install: invalid agent name '${a}'`);
    argv.push("--agents", req.agents.join(","));
  }

  // Lock key: name-keyed for local installs, url-keyed when installing from
  // a remote (no agent name is known yet). The CLI also takes a per-clone
  // filesystem lock via withFileLock so two GUI tabs pulling the same URL
  // serialize correctly.
  const lockKey = req.from ? `agent-install:${req.from}` : `agent:${req.name as string}`;
  return { argv, lockKeys: [lockKey], preview: previewOf(argv) };
}
