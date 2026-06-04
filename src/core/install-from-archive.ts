import { readFile, mkdir, writeFile, rm } from "node:fs/promises";
import { join, dirname, sep } from "node:path";
import { readArchive } from "../io/archive-tar";
import { sha256 } from "../io/hash";
import { pinnedIso } from "../io/manifest-time";
import { ExportManifestSchema, type ExportManifest } from "./export-manifest";
import { SmithError } from "./smith-error";
import { canonicalRegistryPath, loadRegistry, saveRegistry } from "../io/registry";
import { stateHome } from "../io/state-home";

export interface InstallFromArchiveOptions {
  archivePath: string;
  /** Caller-provided producer version (test seam). Production reads package.json. */
  smithVersion: string;
}

export interface InstallFromArchiveResult {
  catalogRootPath: string;
  bundles: string[];
  manifest: ExportManifest;
}

const ZERO_HASH = "0".repeat(64);

export async function installFromArchive(
  opts: InstallFromArchiveOptions,
): Promise<InstallFromArchiveResult> {
  const archive = await readFile(opts.archivePath);
  const sha = sha256(archive);

  let entries;
  try {
    entries = await readArchive(archive);
  } catch (err) {
    throw new SmithError({
      code: "validation-failed",
      what: "archive",
      reasons: [`failed to read archive: ${String(err)}`],
    });
  }

  const manifestEntry = entries.find((e) => e.path.endsWith("/_smith-export.json"));
  if (!manifestEntry) {
    throw new SmithError({
      code: "validation-failed",
      what: "archive",
      reasons: ["missing _smith-export.json — not a smith bundle archive"],
    });
  }
  let manifestRaw: unknown;
  try {
    manifestRaw = JSON.parse(manifestEntry.bytes.toString());
  } catch (err) {
    throw new SmithError({
      code: "validation-failed",
      what: "archive manifest",
      reasons: [`manifest is not valid JSON: ${String(err)}`],
    });
  }
  const parsed = ExportManifestSchema.safeParse(manifestRaw);
  if (!parsed.success) {
    throw new SmithError({
      code: "validation-failed",
      what: "archive manifest",
      reasons: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    });
  }
  const manifest = parsed.data;

  if (cmpSemver(opts.smithVersion, manifest.requires.minSmithVersion) < 0) {
    // The artifact demands a newer smith — the user's command is valid, the
    // artifact itself fails validation. Consistent with every other manifest-
    // level rejection in this file (missing manifest, bad schema, hash mismatch).
    throw new SmithError({
      code: "validation-failed",
      what: "smith version",
      reasons: [
        `archive requires smith ≥ ${manifest.requires.minSmithVersion}; you have ${opts.smithVersion}`,
      ],
      suggestedCommand: "smith update",
    });
  }

  // Verify content hashes. Only the manifest's self-entry may carry the
  // all-zero placeholder (it cannot include its own hash). Every other file
  // must have a real sha256; skipping hash checks for arbitrary files would
  // allow an attacker to include tampered payloads undetected.
  for (const f of manifest.contents.files) {
    const isSelfEntry = f.path.endsWith("/_smith-export.json") && f.sha256 === ZERO_HASH;
    if (isSelfEntry) continue;
    const e = entries.find((x) => x.path === f.path);
    if (!e) {
      throw new SmithError({
        code: "validation-failed",
        what: "archive contents",
        reasons: [`manifest references missing file: ${f.path}`],
      });
    }
    const actual = sha256(e.bytes);
    if (actual !== f.sha256) {
      throw new SmithError({
        code: "validation-failed",
        what: "archive contents",
        reasons: [`hash mismatch for ${f.path} (corrupted artifact)`],
      });
    }
  }

  // Stage to <stateHome>/imported/<sha-prefix>/
  // The catalog root is this directory; agent bundle subdirs live inside it
  // (e.g. <catalogRootPath>/<bundleName>/agent.config.json).
  const catalogRootPath = join(stateHome(), "imported", sha.slice(0, 12));
  await mkdir(catalogRootPath, { recursive: true });

  // Remove any previously staged copy of this bundle to ensure idempotency.
  const bundleStageDir = join(catalogRootPath, manifest.bundle.name);
  // Defense-in-depth: the schema regex already rejects traversal sequences, but
  // this guard catches any future schema loosening or path.join surprises.
  if (!bundleStageDir.startsWith(catalogRootPath + sep) && bundleStageDir !== catalogRootPath) {
    throw new SmithError({
      code: "validation-failed",
      what: "archive contents",
      reasons: [`bundle name resolves outside the staging root: ${manifest.bundle.name}`],
    });
  }
  await rm(bundleStageDir, { recursive: true, force: true });

  // Stage only the files declared in the manifest. Writing every archive
  // entry whose path starts with the bundle prefix would allow extra undeclared
  // files to land on disk even though they were never hash-verified.
  for (const f of manifest.contents.files) {
    const isSelfEntry = f.path.endsWith("/_smith-export.json") && f.sha256 === ZERO_HASH;
    if (!f.path.startsWith(`${manifest.bundle.name}/`)) continue;
    const e = entries.find((x) => x.path === f.path);
    // The hash-verification loop above already ensures every non-self-entry
    // has a matching archive entry; this is a defense-in-depth guard.
    if (!e && !isSelfEntry) continue;
    if (!e) continue;
    const rel = f.path.slice(`${manifest.bundle.name}/`.length);
    const out = join(bundleStageDir, rel);
    if (!out.startsWith(bundleStageDir + sep)) {
      throw new SmithError({
        code: "validation-failed",
        what: "archive contents",
        reasons: [`archive entry path escapes staging directory: ${f.path}`],
      });
    }
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, e.bytes);
  }

  // Register the catalog. The importedArchive block tracks the source
  // artifact for list/catalogs/update display.
  const regPath = canonicalRegistryPath();
  const reg = await loadRegistry(regPath);
  const importedArchive = {
    artifactPath: opts.archivePath,
    sha256: sha,
    importedAt: pinnedIso(new Date()),
  };
  const existing = reg.sources.find((s) => s.rootPath === catalogRootPath);
  if (existing) {
    existing.importedArchive = importedArchive;
  } else {
    reg.sources.push({
      kind: "registered",
      rootPath: catalogRootPath,
      label: `imported/${manifest.bundle.name}`,
      importedArchive,
    });
  }
  await saveRegistry(regPath, reg);

  return { catalogRootPath, bundles: [manifest.bundle.name], manifest };
}

function cmpSemver(a: string, b: string): number {
  const aa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const bb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const av = aa[i] ?? 0;
    const bv = bb[i] ?? 0;
    if (av !== bv) return av < bv ? -1 : 1;
  }
  return 0;
}
