import { copyFile, mkdir, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import pc from "picocolors";
import { importApmBundle } from "../../core/apm-import";
import { CanonicalConfigSchema, parseConfig } from "../../core/config-schema";
import { SmithError } from "../../core/smith-error";
import { toMessage } from "../../core/to-message";
import type { CanonicalConfig, PermissionConfig, SourceKind } from "../../core/types";
import { CANONICAL_USER_MD_TEMPLATE } from "../../io/user-template";
import { assertValidAgentName } from "../agent-name";

export interface InitAgentOpts {
  description?: string;
  targets?: CanonicalConfig["targets"];
  modelTier?: CanonicalConfig["modelTier"];
  mode?: CanonicalConfig["mode"];
  permission?: PermissionConfig;
  mcpServers?: string[];
  skills?: string[];
  requiresSkills?: Array<{ catalog?: string; name: string }>;
  /** Stdout sink. Defaults to `console.log`. */
  print?: (msg: string) => void;
  /** Stderr sink. Defaults to `console.warn` for the symlink-target advisory. */
  printErr?: (msg: string) => void;
}

export interface InitAgentPaths {
  agentsDir: string;
  canonicalUserPath: string;
  from?: string;
  /**
   * Optional fallback directory containing example bundles shipped with the
   * package. When `from` is set and the source is not found in `agentsDir`,
   * the resolver consults `examplesDir` next. `agentsDir` always wins on
   * collision so users' local edits remain authoritative.
   */
  examplesDir?: string;
  /**
   * Kind of the catalog the bundle is being scaffolded into. Determines
   * USER.md handling:
   *   - "registered": write a stub file (do not symlink — symlink targets
   *     would be machine-local paths invalid on teammates' machines).
   *   - "user-global" | "project" | undefined: symlink USER.md to
   *     `canonicalUserPath` (existing behavior).
   * Undefined is treated as "user-global" for backwards compatibility.
   */
  catalogKind?: SourceKind;
  /**
   * Absolute path to a Microsoft APM `apm.yml` file. Mutually exclusive
   * with `from`: the apm flow imports a foreign bundle one-way (see
   * src/core/apm-import.ts) rather than cloning a local smith bundle.
   * When set, the imported persona content is written verbatim into the
   * new bundle's IDENTITY/EXPERTISE/SOUL files (no on-disk source dir),
   * and the imported config seeds the merge in place of a `--from` clone.
   */
  fromApm?: string;
}

/**
 * Content written as the bundle's USER.md when scaffolding into a
 * `registered` catalog. Replaces the per-user symlink that would otherwise
 * point at the author's home directory (and break for every teammate who
 * clones the repo). The stub is harmless on disk — installs render their
 * own per-platform USER.md independently of this file.
 */
export const BUNDLE_USER_STUB = `# USER context

This file is a placeholder.

In a typical install, this path is a symlink pointing at the user's
canonical USER.md in agent-smith's state home (typically
\`~/.config/agent-smith/USER.md\`, or \`$XDG_CONFIG_HOME/agent-smith/USER.md\`
when \`XDG_CONFIG_HOME\` is set). The canonical file is shared
across every agent in the install — global preferences, environment notes,
name, and project context live there.

This bundle was scaffolded into a registered (team-shared) catalog, so the
symlink was intentionally not created — committing a symlink to a
machine-local path would break for every teammate who clones the repo.
Each install of this bundle will get its own symlink at render time.

If you are the bundle author and want to inspect the install behavior,
see \`smith agent install\` documentation in the agent-smith guide.
`;

const STUB_PERSONA = (file: string): string =>
  `<!-- TODO: write second-person ${file} content; this stub will fail the validator -->\n`;

/**
 * Probe a path with stat() and return whether it exists. Re-raises any
 * non-ENOENT error (EACCES on parent dir, EIO, etc.) so we don't silently
 * treat permission/IO problems as "missing".
 */
async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return false;
    throw err;
  }
}

export async function initAgent(
  name: string,
  opts: InitAgentOpts,
  paths: InitAgentPaths,
): Promise<number> {
  assertValidAgentName(name);
  if (paths.from !== undefined) {
    assertValidAgentName(paths.from, "--from source");
  }
  const print = opts.print ?? ((m: string) => console.log(m));
  const printErr = opts.printErr ?? ((m: string) => console.warn(m));
  // Fast-fail: validate user-supplied --description BEFORE any --from
  // resolution / file IO so the error clearly points at the user's flag
  // rather than surfacing as a confusing post-merge schema failure.
  if (opts.description !== undefined) {
    const descCheck = CanonicalConfigSchema.shape.description.safeParse(opts.description);
    if (!descCheck.success) {
      throw new SmithError({
        code: "validation-failed",
        what: "--description",
        reasons: descCheck.error.issues.map((i) => i.message),
        suggestedCommand: `smith agent init ${name} --description "<one-line action phrase, 10-200 chars>"`,
      });
    }
  }

  const dir = join(paths.agentsDir, name);

  if (await pathExists(dir)) {
    throw new SmithError({
      code: "already-exists",
      what: "agent",
      identifier: name,
      suggestedCommand: `smith agent destroy ${name}`,
    });
  }

  if (paths.from && paths.fromApm) {
    throw new SmithError({
      code: "usage-error",
      message: "--from and --from-apm are mutually exclusive",
    });
  }

  let baseConfig: Partial<CanonicalConfig>;
  let copyFiles: { name: string; sourcePath: string }[] = [];
  // Persona files supplied as in-memory content (used by the --from-apm
  // path, which has no on-disk source dir to copyFile from). Written
  // verbatim alongside the agent.config.json. Same per-bundle file
  // contract as the --from clone branch — IDENTITY/EXPERTISE/SOUL.
  let writeFiles: { name: string; content: string }[] = [];

  if (paths.fromApm) {
    const imported = await importApmBundle({ apmPath: paths.fromApm });
    baseConfig = imported.config;
    writeFiles = [
      { name: "IDENTITY.md", content: imported.persona.identity },
      { name: "EXPERTISE.md", content: imported.persona.expertise },
      { name: "SOUL.md", content: imported.persona.soul },
    ];
  } else if (paths.from) {
    // Resolve `from` against agentsDir first (user's local copy wins on
    // collision), then fall back to examplesDir for bundled example sources.
    const localCandidate = join(paths.agentsDir, paths.from);
    const exampleCandidate = paths.examplesDir ? join(paths.examplesDir, paths.from) : undefined;
    let srcDir: string | undefined;
    if (await pathExists(localCandidate)) {
      srcDir = localCandidate;
    } else if (exampleCandidate && (await pathExists(exampleCandidate))) {
      srcDir = exampleCandidate;
    }
    if (!srcDir) {
      const searched = exampleCandidate
        ? `searched ${localCandidate} and ${exampleCandidate}`
        : `searched ${localCandidate}`;
      throw new SmithError({
        code: "not-found",
        what: "source agent",
        identifier: paths.from,
        suggestedCommand: `smith agent list   # (${searched})`,
      });
    }
    const srcConfigPath = join(srcDir, "agent.config.json");
    let srcConfigText: string;
    try {
      srcConfigText = await readFile(srcConfigPath, "utf8");
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        throw new SmithError({
          code: "not-found",
          what: "source agent config",
          identifier: srcConfigPath,
          suggestedCommand: `smith agent list`,
        });
      }
      if (code === "EACCES" || code === "EPERM") {
        throw new SmithError({
          code: "permission-denied",
          path: srcConfigPath,
          operation: "read",
        });
      }
      throw new SmithError({
        code: "validation-failed",
        what: "source agent config",
        reasons: [`could not read source config: ${toMessage(err)}`],
      });
    }
    try {
      baseConfig = JSON.parse(srcConfigText) as Partial<CanonicalConfig>;
    } catch (err) {
      throw new SmithError({
        code: "validation-failed",
        what: "source agent config",
        reasons: [`malformed JSON: ${toMessage(err)}`],
        suggestedCommand: `smith agent validate ${paths.from}`,
      });
    }
    // Validate the source config so legacy v0.1.x `tools` fields surface a
    // clear migration error instead of being silently dropped during the merge.
    const srcParsed = parseConfig(baseConfig);
    if (!srcParsed.success) {
      throw new SmithError({
        code: "validation-failed",
        what: "source agent config",
        reasons: srcParsed.errors,
        suggestedCommand: `smith agent validate ${paths.from}`,
      });
    }
    copyFiles = [
      { name: "IDENTITY.md", sourcePath: join(srcDir, "IDENTITY.md") },
      { name: "EXPERTISE.md", sourcePath: join(srcDir, "EXPERTISE.md") },
      { name: "SOUL.md", sourcePath: join(srcDir, "SOUL.md") },
    ];
  } else {
    baseConfig = {};
    copyFiles = [];
  }

  const config: CanonicalConfig = {
    schemaVersion: 1,
    name,
    description: opts.description ?? baseConfig.description ?? "",
    targets: opts.targets ?? baseConfig.targets ?? ["opencode", "claude-code", "codex"],
    modelTier: opts.modelTier ?? baseConfig.modelTier ?? "balanced",
    ...(opts.mode !== undefined
      ? { mode: opts.mode }
      : baseConfig.mode !== undefined
        ? { mode: baseConfig.mode }
        : {}),
    ...(opts.permission !== undefined
      ? { permission: opts.permission }
      : baseConfig.permission !== undefined
        ? { permission: baseConfig.permission }
        : {}),
    ...(opts.mcpServers
      ? { mcpServers: opts.mcpServers }
      : baseConfig.mcpServers
        ? { mcpServers: baseConfig.mcpServers }
        : {}),
    ...(opts.skills
      ? { skills: opts.skills }
      : baseConfig.skills
        ? { skills: baseConfig.skills }
        : {}),
    ...(opts.requiresSkills
      ? { requires: { skills: opts.requiresSkills } }
      : baseConfig.requires
        ? { requires: baseConfig.requires }
        : {}),
    // No CLI flag for knowledge yet — pass through whatever the source
    // (--from clone or --from-apm import) declared. Required for APM
    // imports, which always seed a knowledge.compile block.
    ...(baseConfig.knowledge ? { knowledge: baseConfig.knowledge } : {}),
  };

  if (config.description.length === 0) {
    throw new SmithError({
      code: "usage-error",
      message: "--description is required (or use --from to inherit one)",
      suggestedCommand: `smith agent init ${name} --description "<one-line action phrase>"`,
    });
  }

  // Schema-validate the merged config before writing anything.
  const parsed = parseConfig(config);
  if (!parsed.success) {
    throw new SmithError({
      code: "validation-failed",
      what: "agent config",
      reasons: parsed.errors,
    });
  }

  await mkdir(dir, { recursive: true });

  if (copyFiles.length > 0) {
    for (const f of copyFiles) {
      await copyFile(f.sourcePath, join(dir, f.name));
    }
  } else if (writeFiles.length > 0) {
    for (const f of writeFiles) {
      await writeFile(join(dir, f.name), f.content);
    }
  } else {
    for (const f of ["IDENTITY.md", "EXPERTISE.md", "SOUL.md"]) {
      await writeFile(join(dir, f), STUB_PERSONA(f));
    }
  }

  // Self-bootstrap: if the canonical USER.md doesn't exist, seed it
  // with the same template `smith init` writes (init.ts:69) before
  // creating the bundle's symlink. This eliminates the rc.2
  // broken-symlink edge case where `smith agent init my-bot` on a
  // never-initialized state created a symlink pointing at a
  // non-existent target. Skip for registered catalogs (the stub path
  // writes a literal USER.md instead — no symlink to seed for).
  if (paths.catalogKind !== "registered" && !(await pathExists(paths.canonicalUserPath))) {
    await mkdir(dirname(paths.canonicalUserPath), { recursive: true });
    await writeFile(paths.canonicalUserPath, CANONICAL_USER_MD_TEMPLATE);
    print(pc.cyan(`Seeded canonical USER.md at ${paths.canonicalUserPath}`));
  }

  // Registered catalogs are committed to git; symlinks to ~/ paths would break for teammates. See BUNDLE_USER_STUB.
  if (paths.catalogKind === "registered") {
    await writeFile(join(dir, "USER.md"), BUNDLE_USER_STUB);
  } else {
    await symlink(paths.canonicalUserPath, join(dir, "USER.md"));
  }

  await writeFile(join(dir, "agent.config.json"), `${JSON.stringify(config, null, 2)}\n`);

  print(`${pc.green("Created")} ${dir}`);
  if (copyFiles.length === 0 && writeFiles.length === 0) {
    print(
      [
        pc.dim("Stub persona files written. Edit them, then run"),
        pc.bold(`smith agent validate ${name}`),
        pc.dim("→"),
        pc.bold(`smith agent install ${name}`),
      ].join(" "),
    );
  } else if (writeFiles.length > 0) {
    print(
      [
        pc.dim("APM import complete. Review the persona files, then run"),
        pc.bold(`smith agent validate ${name}`),
        pc.dim("→"),
        pc.bold(`smith agent install ${name}`),
      ].join(" "),
    );
  }
  return 0;
}
