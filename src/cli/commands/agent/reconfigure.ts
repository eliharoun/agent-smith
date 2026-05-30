/**
 * `smith agent reconfigure <name>` — retroactive grant/revoke of refresh
 * hooks for an installed agent, per spec §10. Two modes:
 *
 *   - non-interactive: `--grant` and `--revoke` accept comma-separated
 *     platform ids and operate on the per-agent refresh-manifest plus
 *     the per-platform hook primitives from phases 3-5.
 *   - interactive (v1-task B1 part 2): when `interactive: true` and
 *     stdin is a TTY, prompt the user per-installed-platform with the
 *     same yes/no grammar as `install`. Selecting yes performs the
 *     grant, selecting no leaves the platform's state unchanged.
 *     Non-TTY + interactive throws usage-error rather than silently
 *     defaulting — CI must be explicit (use --grant/--revoke or --yes).
 *
 * Validation is fully up-front: invalid platform ids, overlap between
 * grant and revoke, and grants targeting a platform the agent isn't
 * installed for are all rejected BEFORE any side effects. Grants and
 * revokes are individually idempotent. Empty grant + empty revoke
 * (with `interactive: false`) is a no-op that does not touch disk
 * (no manifest auto-creation).
 */
import { stat } from "node:fs/promises";
import { join } from "node:path";
import {
  defaultAgentSmithHome,
  defaultCodexHome,
  defaultInstallPaths,
  defaultOpencodeConfigHome,
} from "../../install-paths";
import {
  readRefreshManifest,
  writeRefreshManifest,
  type RefreshManifest,
} from "../../../core/knowledge/refresh-manifest";
import { SmithError } from "../../../core/smith-error";
import type { InstallPaths } from "../../../core/types";
import {
  registerClaudeCodeRefreshHook,
  unregisterClaudeCodeRefreshHook,
} from "../../../io/claude-code-hooks";
import {
  registerAgentInCodexHooks,
  removeAgentFromCodexHooks,
} from "../../../io/codex-hooks";
import {
  registerAgentInOpencodePlugin,
  unregisterAgentFromOpencodePlugin,
} from "../../../io/opencode-plugin";
import { PLATFORM_IDS, type PlatformId } from "../../../io/platform-detect";
import { assertValidAgentName } from "../../agent-name";
import { readToken } from "../../prompt";

export interface ReconfigureOptions {
  grant: PlatformId[];
  revoke: PlatformId[];
  /** v1-task B1 part 2: when true (and TTY), prompt per-installed
   *  platform for grant. When false (default), --grant/--revoke must
   *  be supplied or the caller is a no-op. */
  interactive?: boolean;
}

export interface ReconfigureDeps {
  agentSmithHome?: string;
  paths?: InstallPaths;
  codexHome?: string;
  opencodeHome?: string;
  /** Prompt DI seam (defaults to readToken). Used in interactive mode. */
  prompt?: (msg: string) => Promise<string>;
  /** TTY detector DI seam (defaults to process.stdin.isTTY). */
  isTTY?: () => boolean;
  /** Stderr DI seam for the per-platform prompt copy. */
  printErr?: (msg: string) => void;
}

/**
 * Compute the on-disk path the installer wrote for `(agent, platform)`.
 *
 * Per-platform layouts mirror the translators in `src/core/translators/`:
 *   - opencode    → `<dir>/<name>.md`
 *   - claude-code → `<dir>/<name>.md`
 *   - codex       → `<dir>/<name>/SKILL.md`
 *   - kiro        → `<dir>/<name>.json`
 *
 * Pre-fix this function returned `<name>.md` for kiro (no kiro branch),
 * so reconfigure's "is this platform installed?" check always failed
 * for kiro — even when the JSON file was sitting on disk. Same bug
 * shape as InstallMatrixGrid before its Kiro update.
 */
function installPathFor(agent: string, platform: PlatformId, paths: InstallPaths): string {
  if (platform === "codex") return join(paths.codex, agent, "SKILL.md");
  if (platform === "kiro") return join(paths.kiro, `${agent}.json`);
  return join(paths[platform], `${agent}.md`);
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function isValidPlatform(p: string): p is PlatformId {
  return (PLATFORM_IDS as readonly string[]).includes(p);
}

export async function reconfigureAgent(
  agent: string,
  opts: ReconfigureOptions,
  deps: ReconfigureDeps = {},
): Promise<void> {
  assertValidAgentName(agent);
  const grant = opts.grant ?? [];
  const revoke = opts.revoke ?? [];

  // --- Validation (up-front, no side effects) -----------------------------
  // 1. Invalid platform ids — rejected before any disk read.
  for (const p of [...grant, ...revoke]) {
    if (!isValidPlatform(p)) {
      throw new SmithError({
        code: "usage-error",
        message: `invalid platform '${p}' (expected one of: ${PLATFORM_IDS.join(", ")})`,
      });
    }
  }

  // 2. Overlap between grant and revoke is ambiguous — reject.
  const grantSet = new Set(grant);
  const overlap = revoke.filter((p) => grantSet.has(p));
  if (overlap.length > 0) {
    throw new SmithError({
      code: "usage-error",
      message: `platform(s) appear in both --grant and --revoke: ${overlap.join(", ")}`,
    });
  }

  // 3. Empty-empty is a no-op... unless we're in interactive mode, in
  //    which case the prompts replace --grant. Resolve the interactive
  //    flow BEFORE the bare-empty short-circuit so prompted-grants
  //    proceed to the side-effect phase normally. v1-task B1 part 2.
  let workingGrant = grant;
  if (grant.length === 0 && revoke.length === 0 && opts.interactive) {
    const isTty = deps.isTTY ? deps.isTTY() : Boolean(process.stdin.isTTY);
    if (!isTty) {
      // CI without --grant/--revoke is ambiguous — refuse rather than
      // silently default to "grant nothing" (which would mask user
      // mistakes). Mirror the install-time non-TTY policy of being
      // explicit about what's needed to proceed.
      throw new SmithError({
        code: "usage-error",
        message:
          "interactive reconfigure requires a TTY; pass --grant <list>, --revoke <list>, or --yes for non-interactive mode",
      });
    }
    // Probe which platforms the agent is actually installed for,
    // then prompt per-installed-platform. Platforms not installed
    // are silently skipped (you can't grant a hook for a platform
    // the agent doesn't exist on).
    const paths = deps.paths ?? defaultInstallPaths();
    const installed: PlatformId[] = [];
    for (const p of PLATFORM_IDS) {
      if (await exists(installPathFor(agent, p, paths))) installed.push(p);
    }
    const promptFn = deps.prompt ?? readToken;
    const printErrFn = deps.printErr ?? ((m: string) => console.error(m));
    const prompted: PlatformId[] = [];
    for (const p of installed) {
      printErrFn(`Grant refresh-hook consent for ${agent} on ${p}? [y/n]`);
      const answer = (await promptFn("> ")).trim().toLowerCase();
      // Accept y/yes (case-insensitive); anything else is treated as no.
      // The install-time consent flow uses readConsentChoice which has
      // a richer grammar (yes/no/details); reconfigure deliberately stays
      // simpler — no per-platform details payload, just the toggle.
      if (answer === "y" || answer === "yes") prompted.push(p);
    }
    workingGrant = prompted;
    // If the user said no to everything, fall through to the existing
    // empty-empty no-op (no manifest created). The test
    // "interactive: all 'no' answers do not auto-create an empty manifest"
    // pins this behavior.
    if (workingGrant.length === 0) return;
  } else if (grant.length === 0 && revoke.length === 0) {
    return;
  }

  // 4. Grants for non-installed platforms — fail before any side effect.
  const paths = deps.paths ?? defaultInstallPaths();
  for (const p of workingGrant) {
    const path = installPathFor(agent, p, paths);
    if (!(await exists(path))) {
      throw new SmithError({
        code: "usage-error",
        message: `${agent} is not installed for ${p} — install it first with 'smith agent install ${agent} --target ${p}'`,
      });
    }
  }

  // --- Side effects (revokes → grants → manifest) -------------------------
  const home = deps.agentSmithHome ?? defaultAgentSmithHome();
  const codexHome = deps.codexHome ?? defaultCodexHome();
  const opencodeHome = deps.opencodeHome ?? defaultOpencodeConfigHome();

  const existing = await readRefreshManifest(home, agent);
  // Auto-create on first reconfigure. Sources stays empty — this command
  // toggles platforms, not per-source consent. (Sources are owned by the
  // initial install-time consent flow.)
  const manifest: RefreshManifest = existing ?? {
    schemaVersion: 1,
    agent,
    refresh_consent: {
      granted_at: new Date().toISOString(),
      platforms: [],
      sources: [],
    },
  };
  const platformsBefore = [...manifest.refresh_consent.platforms];

  // Revokes first. Each is idempotent on its own primitive AND we additionally
  // gate the side-effect call on "is this platform actually in the manifest?"
  // so a revoke of a never-granted platform doesn't touch disk at all.
  for (const p of revoke) {
    if (!manifest.refresh_consent.platforms.includes(p)) continue;
    if (p === "codex") {
      await removeAgentFromCodexHooks(codexHome, agent);
    } else if (p === "opencode") {
      await unregisterAgentFromOpencodePlugin(opencodeHome, agent);
    } else if (p === "claude-code") {
      await unregisterClaudeCodeRefreshHook(installPathFor(agent, p, paths), agent);
    }
    manifest.refresh_consent.platforms = manifest.refresh_consent.platforms.filter((x) => x !== p);
  }

  // Grants next. Same idempotency strategy: skip the primitive when already
  // recorded in the manifest.
  for (const p of workingGrant) {
    if (manifest.refresh_consent.platforms.includes(p)) continue;
    if (p === "codex") {
      await registerAgentInCodexHooks(codexHome, agent);
    } else if (p === "opencode") {
      await registerAgentInOpencodePlugin(opencodeHome, agent);
    } else if (p === "claude-code") {
      await registerClaudeCodeRefreshHook(installPathFor(agent, p, paths), agent);
    }
    manifest.refresh_consent.platforms.push(p);
  }

  // Only persist if the platform set actually changed. Skipping the write
  // when nothing moved preserves byte-equality of the manifest file across
  // idempotent calls (the test suite asserts this for already-granted
  // grants and never-granted revokes).
  const changed =
    manifest.refresh_consent.platforms.length !== platformsBefore.length ||
    manifest.refresh_consent.platforms.some((p, i) => p !== platformsBefore[i]);
  // Guard against auto-creating an empty manifest for a no-op revoke. The
  // empty-empty short-circuit above (line ~106) covers grant=[] && revoke=[],
  // but a revoke-only call against a never-existed manifest (no `existing`,
  // platforms still []) would otherwise fall through and write a zero-platform
  // manifest below. Symmetrically, a grant of an already-granted platform on
  // a not-yet-existing manifest would skip the push and leave platforms=[].
  // In both cases, do nothing — match the "no manifest" precondition exactly.
  if (!existing && manifest.refresh_consent.platforms.length === 0) return;
  if (!changed && existing) return;
  await writeRefreshManifest(home, agent, manifest);
}
