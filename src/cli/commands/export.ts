import { writeFile, mkdir, stat } from "node:fs/promises";
import { join, dirname, isAbsolute, resolve } from "node:path";
import pc from "picocolors";
import { exportBundle } from "../../core/export-bundle";
import { findBundleOrFail, loadAllBundles } from "../load-all";
import { SmithError } from "../../core/smith-error";
import { formatDirectoryExportSummary, formatExportSummary } from "../format-export";
import { canonicalRegistryPath, loadRegistry } from "../../io/registry";
import { readSmithVersion } from "../../io/smith-version";

export interface ExportAgentOptions {
  to: string;
  includeSkills: boolean;
  userMd: "stub" | "keep" | "reject";
  compression: "gzip" | "none";
  json: boolean;
  dryRun: boolean;
  stdout: boolean;
  /** Output format. Default "archive". */
  format?: "archive" | "directory";
  /** Directory mode: include the auto-generated README.md (off by default). */
  withReadme?: boolean;
  /** Directory mode: drop _smith-export.json (kept by default). */
  noManifest?: boolean;
  /** Directory mode: replace <to>/<name>/ if it exists. */
  force?: boolean;
}

export interface ExportAgentResult {
  exitCode: 0 | 1 | 2;
  artifactPath?: string;
  archiveSha256?: string;
  manifestJson?: string;
  errorMessage?: string;
  /** Directory mode: absolute path of the bundle dir written. */
  outputPath?: string;
}

export async function exportAgent(
  name: string,
  opts: ExportAgentOptions,
): Promise<ExportAgentResult> {
  // Mutex validation: reject incompatible flag combos before doing any I/O.
  const format = opts.format ?? "archive";
  if (format === "directory" && opts.stdout) {
    process.stderr.write(
      `${pc.red("error:")} cannot stream a directory tree to stdout (--format directory is incompatible with --stdout)\n`,
    );
    return { exitCode: 1, errorMessage: "--format directory cannot be combined with --stdout" };
  }
  if (format === "directory" && opts.compression === "none") {
    process.stderr.write(
      `${pc.red("error:")} --compression has no effect in directory mode\n`,
    );
    return { exitCode: 1, errorMessage: "--compression has no effect in directory mode" };
  }

  try {
    const registry = await loadRegistry(canonicalRegistryPath());
    const all = await loadAllBundles(registry);
    const bundle = findBundleOrFail(all, name);

    const smithVersion = await readSmithVersion();

    const result = await exportBundle({
      bundlePath: bundle.bundlePath,
      bundleName: bundle.config.name,
      includeSkills: opts.includeSkills,
      userMdPolicy: opts.userMd,
      now: () => new Date(),
      smithVersion,
      format,
      ...(format === "directory"
        ? {
            outputPath: opts.to,
            includeManifest: !opts.noManifest,
            includeReadme: opts.withReadme === true,
            force: opts.force === true,
          }
        : { compression: opts.compression }),
    });

    if (opts.dryRun) {
      const out = JSON.stringify(result.manifest, null, 2);
      if (opts.json) process.stdout.write(out);
      else process.stdout.write(`${pc.dim("(dry run)")}\n${out}\n`);
      return { exitCode: 0, manifestJson: out };
    }

    if (format === "directory") {
      if (!opts.json && process.stdout.isTTY) {
        process.stdout.write(
          formatDirectoryExportSummary({
            bundleName: bundle.config.name,
            outputPath: result.outputPath!,
            filesWritten: result.filesWritten ?? [],
          }) + "\n",
        );
      } else if (opts.json) {
        process.stdout.write(
          JSON.stringify({ outputPath: result.outputPath, filesWritten: result.filesWritten }),
        );
      }
      return { exitCode: 0, outputPath: result.outputPath! };
    }

    // The CLI currently only runs in archive mode at this point; guard so
    // TypeScript knows archive and archiveSha256 are defined from here forward.
    if (result.format !== "archive" || result.archive === undefined || result.archiveSha256 === undefined) {
      throw new SmithError({
        code: "validation-failed",
        what: "export result",
        reasons: ["unexpected directory-mode result in archive-only CLI path"],
      });
    }

    if (opts.stdout) {
      process.stdout.write(result.archive);
      return { exitCode: 0, archiveSha256: result.archiveSha256 };
    }

    const sha = result.archiveSha256.slice(0, 7);
    const filename = `${bundle.config.name}-${sha}.smith-bundle.tgz`;
    const outPath = await resolveOutputPath(opts.to, filename);
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, result.archive);

    const installCmd = `smith agent install --from ${outPath}`;
    const summary = formatExportSummary({
      bundleName: bundle.config.name,
      artifactPath: outPath,
      size: result.archive.length,
      sha256: result.archiveSha256,
      installCommand: installCmd,
      embeddedSkills: result.manifest.contents.skillBundles.length,
      remoteKnowledgeCount: result.manifest.requires.remoteKnowledge.length,
      mcpRequiredCount: result.manifest.requires.mcpServers.required.length,
    });
    if (opts.json) {
      process.stdout.write(
        JSON.stringify({ artifactPath: outPath, sha256: result.archiveSha256, installCommand: installCmd }),
      );
    } else {
      process.stdout.write(summary + "\n");
    }
    return { exitCode: 0, artifactPath: outPath, archiveSha256: result.archiveSha256 };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof SmithError) {
      process.stderr.write(`${pc.red("error:")} ${message}\n`);
      return { exitCode: 1, errorMessage: message };
    }
    if (err instanceof Error && (err as NodeJS.ErrnoException).code) {
      process.stderr.write(`${pc.red("io error:")} ${message}\n`);
      return { exitCode: 2, errorMessage: message };
    }
    process.stderr.write(`${pc.red("error:")} ${message}\n`);
    return { exitCode: 1, errorMessage: message };
  }
}

async function resolveOutputPath(to: string, filename: string): Promise<string> {
  const abs = isAbsolute(to) ? to : resolve(process.cwd(), to);
  let isDir = false;
  try {
    isDir = (await stat(abs)).isDirectory();
  } catch {
    if (abs.endsWith(".tgz") || abs.endsWith(".smith-bundle.tgz")) return abs;
    return join(abs, filename);
  }
  if (isDir) return join(abs, filename);
  // Existing path is a file. Only accept if its name has the archive suffix.
  if (abs.endsWith(".tgz") || abs.endsWith(".smith-bundle.tgz")) return abs;
  throw new SmithError({
    code: "validation-failed",
    what: "output path",
    reasons: [`refusing to overwrite ${abs} (not an archive file)`],
  });
}
