import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { CompileManifest } from "./compile";

const MANIFEST_NAME = "compile-manifest.json";

export function compileManifestPath(knowledgeDir: string): string {
  return join(knowledgeDir, MANIFEST_NAME);
}

export async function readCompileManifest(
  knowledgeDir: string,
): Promise<CompileManifest | undefined> {
  try {
    const raw = await readFile(compileManifestPath(knowledgeDir), "utf8");
    const parsed = JSON.parse(raw);
    if (parsed?.schemaVersion === 1 && typeof parsed.contentHash === "string") {
      return parsed as CompileManifest;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export async function writeCompileManifest(
  knowledgeDir: string,
  manifest: CompileManifest,
): Promise<void> {
  const path = compileManifestPath(knowledgeDir);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}
