// Subcommand factory for `smith skill install|update|uninstall`. Pulled
// out of src/index.ts so tests can mount the same wiring on a fresh
// Commander program with overridden home/platform dirs.

import { homedir } from "node:os";
import { join } from "node:path";
import type { Command } from "commander";
import pc from "picocolors";
import { SmithError } from "../../../core/smith-error";
import { loadInstalledSkills } from "../../../io/installed-skills";
import { ensureCloneExists } from "../../../io/lazy-clone";
import { detectPython, pythonNotInstalledRemediation } from "../../../io/python-runtime";
import { resolveAdHocSource } from "../../../io/skill-discovery";
import {
  installSkill,
  isSafeSkillName,
  type PlatformId,
  uninstallSkill,
  updateSkill,
} from "../../../io/skill-installer";
import {
  addCatalog,
  canonicalSkillRegistryPath,
  loadSkillRegistry,
  saveSkillRegistry,
} from "../../../io/skill-registry";
import { type WrapDeps, wrap } from "../../wrap";
import { promptMultiSelect } from "../../multi-select";
import type { DiscoveredBundle } from "../../../core/install-from-url";

export interface RegisterSkillInstallOpts {
  /**
   * Test seam: override $HOME for state file, registry file, AND default
   * per-platform skill dirs. Production callers leave this unset.
   */
  homeDirOverride?: string;
  /**
   * Test seam: override `wrap()`'s deps for every action registered here.
   * In particular, tests that drive these subcommands via
   * `program.parseAsync(...)` MUST override `exit` (default: `process.exit`)
   * with a no-op; otherwise wrap()'s on-success exit kills the bun-test
   * runner mid-suite. Production callers leave this unset.
   */
  wrapDepsOverride?: WrapDeps;
  /** Test seam: drives the interactive multi-select. Defaults to readToken. */
  promptOverride?: () => Promise<string>;
  /** Test seam: TTY detection. Defaults to () => Boolean(process.stdin.isTTY). */
  isTtyOverride?: () => boolean;
}

const ALL_PLATFORMS: ReadonlyArray<PlatformId> = ["opencode", "claude-code", "codex", "kiro"];

function parseTargets(s: string | undefined): ReadonlyArray<PlatformId> | undefined {
  if (!s) return undefined;
  const wanted = s.split(",").map((x) => x.trim());
  const known = new Set<string>(ALL_PLATFORMS);
  for (const t of wanted) {
    if (!known.has(t)) {
      throw new SmithError({
        code: "usage-error",
        message: `unknown --targets value '${t}' (allowed: ${ALL_PLATFORMS.join(", ")})`,
        suggestedCommand: `--targets ${ALL_PLATFORMS.join(",")}`,
      });
    }
  }
  return wanted as PlatformId[];
}

function registryPathFor(home: string | undefined): string {
  return home ? `${home}/.config/agent-smith/skill-catalogs.json` : canonicalSkillRegistryPath();
}

export function registerSkillInstallCommands(
  skillCmd: Command,
  opts: RegisterSkillInstallOpts = {},
): void {
  const home = opts.homeDirOverride;
  const wrapDeps = opts.wrapDepsOverride;

  skillCmd
    .command("install")
    .argument("[ref]", "skill name OR catalog/name (omit when using --from)")
    .option(
      "--from <pathOrUrl>",
      "ad-hoc install from a local path OR a git URL (https://, ssh://, git@, file://)",
    )
    .option("--as <name>", "catalog label to use for the auto-created ad-hoc catalog")
    .option("--targets <list>", "comma-separated platforms (opencode,claude-code,codex)")
    .option(
      "--git-ref <ref>",
      "Git branch/tag/SHA to clone with --from when it is a URL. Defaults to remote HEAD.",
    )
    .option("--all", "install every skill discovered in --from <url>")
    .option("--skills <list>", "comma-separated skills to install from --from <url>")
    .option("--json", "discover skills from --from <url>, print JSON, do not install")
    .action(
      wrap(
        "skill install",
        async (
          ref: string | undefined,
          cmdOpts: {
            from?: string;
            as?: string;
            targets?: string;
            gitRef?: string;
            all?: boolean;
            skills?: string;
            json?: boolean;
          },
        ): Promise<number> => {
          const targets = parseTargets(cmdOpts.targets);
          const read = opts.promptOverride ?? ((): Promise<string> => import("../../prompt").then((m) => m.readToken("> ")));
          const isTty = opts.isTtyOverride ?? (() => Boolean(process.stdin.isTTY));

          // v1-task C3.10: --from <url> branch. Clone + register via the
          // shared installFromUrl orchestrator, then route through the
          // standard <catalog>/<name> install path. URL detection is via
          // isLikelyGitUrl — anything that doesn't match falls through to
          // the pre-existing local-path branch (which interprets --from as
          // an on-disk skill directory).
          if (cmdOpts.from) {
            const { isLikelyGitUrl } = await import("../../../io/remote-path");
            if (isLikelyGitUrl(cmdOpts.from)) {
              const { discoverFromUrl, installFromUrl } = await import("../../../core/install-from-url");
              const disco = await discoverFromUrl({
                kind: "skill",
                url: cmdOpts.from,
                ...(cmdOpts.gitRef ? { ref: cmdOpts.gitRef } : {}),
                ...(home ? { homeDir: home, registryPath: registryPathFor(home) } : {}),
              });
              if (cmdOpts.json) { console.log(JSON.stringify({ kind: "skill", ...disco }, null, 2)); return 0; }
              if (ref && (cmdOpts.all || cmdOpts.skills)) {
                throw new SmithError({ code: "usage-error", message: "<ref> cannot be combined with --all/--skills" });
              }
              if (cmdOpts.all && cmdOpts.skills) {
                throw new SmithError({ code: "usage-error", message: "--all cannot be combined with --skills" });
              }
              const names = await resolveSkillSelection(disco.bundles, {
                ref, skills: cmdOpts.skills, all: Boolean(cmdOpts.all), isTty: isTty(), read, from: cmdOpts.from,
              });
              const selectedTargets = targets ?? (isTty() ? await pickPlatforms(disco.detectedTargets, read) : undefined);
              await installFromUrl({ kind: "skill", url: cmdOpts.from, ...(cmdOpts.gitRef ? { ref: cmdOpts.gitRef } : {}), ...(home ? { registryPath: registryPathFor(home) } : {}) });
              const failures: string[] = [];
              for (const n of names) {
                const already = disco.bundles.find((b) => b.name === n)?.alreadyInstalled;
                const r = already
                  ? await updateSkill(n, { ...(home ? { homeDir: home } : {}), ...(selectedTargets ? { targets: selectedTargets } : {}) })
                  : await installSkill(n, { ...(home ? { homeDir: home } : {}), ...(selectedTargets ? { targets: selectedTargets } : {}), catalog: disco.catalog.suggestedLabel });
                if (!r.ok) failures.push(`${n}: ${r.error}`);
                else console.log(pc.green(`Installed '${n}'`));
              }
              // Surface failures before the hint so a partial failure isn't
              // masked by a success-looking message (the catalog is still
              // registered, but the user needs to see what failed first).
              if (failures.length > 0) {
                throw new SmithError({ code: "partial-failure", operation: "skill install", succeeded: names.length - failures.length, failed: failures.length, skipped: 0, details: failures });
              }
              console.log("");
              console.log(`Catalog '${disco.catalog.suggestedLabel}' is registered.`);
              console.log(`  More skills:  smith skill install --from ${cmdOpts.from}`);
              console.log(`  Manage:       smith skill catalogs`);
              return 0;
            }

            // Expand `~` (alone) or leading `~/` so users can paste the
            // same path they'd hand to `cd`. Anything else (absolute,
            // relative) passes through.
            let from = cmdOpts.from;
            if (from === "~") from = homedir();
            else if (from.startsWith("~/")) from = join(homedir(), from.slice(2));
            // Ad-hoc path: resolve the local skill dir into a synthetic
            // catalog, register it (failing on label collision so users get
            // the --as remediation hint), then install.
            const { catalog, skill: discovered } = await resolveAdHocSource(
              from,
              cmdOpts.as ? { as: cmdOpts.as } : undefined,
            );
            const registryPath = registryPathFor(home);
            const reg = await loadSkillRegistry(registryPath);
            // See addCatalog: noop-different-label means same path is
            // already registered under a different label; we warn and keep
            // the existing label as truth.
            const addResult = addCatalog(reg, catalog);
            if (addResult.status === "noop-different-label") {
              console.error(
                `${pc.yellow("⚠ ")}Catalog at ${catalog.rootPath} is already registered as ` +
                  `"${addResult.existingLabel}"; new install was added to it.\n` +
                  `  Use 'smith skill catalog rename ${addResult.existingLabel} <new-label>' ` +
                  `or pass --as <label> on the first install to change the label.`,
              );
            }
            // When the catalog already existed under a different label, the
            // EXISTING label is the truth — use it so the installed-skills
            // record matches what `smith status` shows.
            const effectiveLabel =
              addResult.status === "noop-different-label" ? addResult.existingLabel : catalog.label;
            const r = await installSkill(discovered.name, {
              ...(home ? { homeDir: home } : {}),
              ...(targets ? { targets } : {}),
              sourceOverride: {
                sourceDir: discovered.path,
                sourceCatalogLabel: effectiveLabel,
              },
            });
            if (!r.ok) {
              throw new SmithError({
                code: "validation-failed",
                what: "skill install",
                reasons: [r.error],
              });
            }
            // Only persist the new catalog AFTER a successful install.
            // Saving before install means a failed install would leave a
            // phantom catalog on disk that `smith status` surfaces and
            // subsequent installs silently merge into. The "noop-*"
            // branches return the input registry unchanged so there's
            // nothing to save for those.
            if (addResult.status === "added") {
              await saveSkillRegistry(registryPath, addResult.registry);
            }
            console.log(pc.green(`Installed skill '${discovered.name}' from ${from}`));
            return 0;
          }

          if (!ref) {
            throw new SmithError({
              code: "usage-error",
              message: "missing skill ref",
              suggestedCommand: "smith skill install <name|catalog/name> | --from <path>",
            });
          }
          // Reject obvious path-traversal in the raw ref before splitting.
          // 'foo/bar' is the legitimate <catalog>/<name> form; '../foo' or
          // 'foo/..' is not — they would slip past the per-segment guard
          // because each half-segment of '..' looks innocuous on its own.
          // An absolute path (starts with '/') is almost always a user
          // mistake — they meant `--from <path>` — so steer them toward it.
          if (ref.startsWith("/")) {
            throw new SmithError({
              code: "usage-error",
              message: `looks like an absolute path: '${ref}'`,
              suggestedCommand: `smith skill install --from ${ref}`,
            });
          }
          if (
            ref.includes("..") ||
            ref.includes("\\") ||
            ref.startsWith(".") ||
            ref.split("/").length > 2
          ) {
            throw new SmithError({
              code: "validation-failed",
              what: "skill name",
              reasons: [
                `invalid skill name '${ref}': must be kebab-case, max 64 chars, no slashes, no '..', no leading dot`,
              ],
            });
          }
          const [maybeCatalog, maybeName] = ref.includes("/")
            ? ref.split("/", 2)
            : [undefined, ref];
          // Defense-in-depth: reject obviously bogus names BEFORE touching
          // the filesystem. installSkill() also validates internally.
          if (!maybeName || !isSafeSkillName(maybeName)) {
            throw new SmithError({
              code: "validation-failed",
              what: "skill name",
              reasons: [
                `invalid skill name '${maybeName ?? ""}': must be kebab-case, max 64 chars, no slashes, no '..', no leading dot`,
              ],
            });
          }
          if (maybeCatalog) {
            const registryPath = registryPathFor(home);
            const reg = await loadSkillRegistry(registryPath);
            const cat = reg.catalogs.find((c) => c.label === maybeCatalog);
            if (cat) await ensureCloneExists(cat);
          }
          if (maybeCatalog === "atlassian-skills") {
            const pythonStatus = await detectPython();
            if (!pythonStatus.binary) {
              throw new SmithError({
                code: "usage-error",
                message: pythonNotInstalledRemediation(),
              });
            }
          }
          const r = await installSkill(maybeName, {
            ...(home ? { homeDir: home } : {}),
            ...(maybeCatalog ? { catalog: maybeCatalog } : {}),
            ...(targets ? { targets } : {}),
          });
          if (!r.ok) {
            throw new SmithError({
              code: "validation-failed",
              what: "skill install",
              reasons: [r.error],
            });
          }
          console.log(pc.green(`Installed skill '${maybeName}'`));
          return 0;
        },
        wrapDeps,
      ),
    );

  skillCmd
    .command("update")
    .argument("[name]")
    .option("--all", "update every installed skill")
    .action(
      wrap(
        "skill update",
        async (name: string | undefined, cmdOpts: { all?: boolean }): Promise<number> => {
          if (cmdOpts.all) {
            const file = await loadInstalledSkills(home ? { homeDir: home } : undefined);
            for (const e of file.installed) {
              const r = await updateSkill(e.name, home ? { homeDir: home } : undefined);
              if (!r.ok) {
                throw new SmithError({
                  code: "validation-failed",
                  what: "skill update",
                  reasons: [`${e.name}: ${r.error}`],
                });
              }
              console.log(pc.green(`Updated '${e.name}'`));
            }
            return 0;
          }
          if (!name) {
            throw new SmithError({
              code: "usage-error",
              message: "missing skill name",
              suggestedCommand: "smith skill update <name> | --all",
            });
          }
          const r = await updateSkill(name, home ? { homeDir: home } : undefined);
          if (!r.ok) {
            throw new SmithError({
              code: "validation-failed",
              what: "skill update",
              reasons: [r.error],
            });
          }
          console.log(pc.green(`Updated '${name}'`));
          return 0;
        },
        wrapDeps,
      ),
    );

  skillCmd
    .command("uninstall")
    .argument("<name>")
    .action(
      wrap(
        "skill uninstall",
        async (name: string): Promise<number> => {
          const r = await uninstallSkill(name, home ? { homeDir: home } : undefined);
          if (!r.ok) {
            throw new SmithError({
              code: "validation-failed",
              what: "skill uninstall",
              reasons: [r.error],
            });
          }
          console.log(pc.green(`Uninstalled '${name}'`));
          return 0;
        },
        wrapDeps,
      ),
    );

  skillCmd
    .command("validate")
    .argument("<name>", "skill name (use '<catalog>/<name>' to disambiguate)")
    .description("Validate a registered skill's frontmatter")
    .action(
      wrap(
        "skill validate",
        async (name: string): Promise<number> => {
          const { validateSkillCli } = await import("./validate");
          return await validateSkillCli({
            name,
            ...(home ? { homeDirOverride: home } : {}),
          });
        },
        wrapDeps,
      ),
    );

  skillCmd
    .command("sync")
    .argument("[name]", "skill catalog label or path (omit when using --all)")
    .description("Pull updates for one or all remote-backed skill catalogs (v1-task C3.12)")
    .option("--all", "Sync every remote-backed skill catalog")
    .option("--check", "Only probe remote HEAD (git ls-remote); do not touch working tree")
    .action(
      wrap(
        "skill sync",
        async (
          name: string | undefined,
          cmdOpts: { all?: boolean; check?: boolean },
        ): Promise<number> => {
          const { runSkillSync } = await import("./sync");
          return runSkillSync({
            ...(name ? { name } : {}),
            ...(cmdOpts.all ? { all: true } : {}),
            ...(cmdOpts.check ? { check: true } : {}),
            ...(home ? { registryPath: `${home}/.config/agent-smith/skill-catalogs.json` } : {}),
          });
        },
        wrapDeps,
      ),
    );
}

function excerpt(d: string): string {
  const firstSentence = d.split(/(?<=\.)\s/)[0] ?? d;
  return firstSentence.length > 80 ? `${firstSentence.slice(0, 79)}…` : firstSentence;
}

async function resolveSkillSelection(
  bundles: DiscoveredBundle[],
  o: { ref?: string | undefined; skills?: string | undefined; all: boolean; isTty: boolean; read: () => Promise<string>; from: string },
): Promise<string[]> {
  const valid = new Set(bundles.map((b) => b.name));
  const fail = (n: string) => new SmithError({ code: "usage-error", message: `unknown skill '${n}' (valid: ${[...valid].join(", ")})` });
  if (o.ref) { if (!valid.has(o.ref)) throw fail(o.ref); return [o.ref]; }
  if (o.skills) {
    const list = o.skills.split(",").map((s) => s.trim()).filter(Boolean);
    for (const s of list) if (!valid.has(s)) throw fail(s);
    return list;
  }
  if (o.all) return bundles.map((b) => b.name);
  if (bundles.length === 1) return [bundles[0]!.name];
  if (o.isTty) {
    const idx = await promptMultiSelect(
      bundles.map((b) => ({ label: b.name, hint: excerpt(b.description), ...(b.alreadyInstalled ? { annotation: "[installed]" } : {}) })),
      { read: o.read },
    );
    return idx.map((i) => bundles[i]!.name);
  }
  console.error(`smith: ${o.from} contains ${bundles.length} skills: ${bundles.map((b) => b.name).join(", ")}. Specify which: pass <ref>, --skills <names>, or --all.`);
  throw new SmithError({ code: "usage-error", message: "multiple skills in remote; pass <ref>, --skills, or --all", suggestedCommand: `smith skill install --all --from ${o.from}` });
}

async function pickPlatforms(detected: string[], read: () => Promise<string>): Promise<PlatformId[] | undefined> {
  if (detected.length === 0) return undefined;
  const idx = await promptMultiSelect(detected.map((d) => ({ label: d })), { read, defaultAll: true });
  return idx.map((i) => detected[i] as PlatformId);
}
