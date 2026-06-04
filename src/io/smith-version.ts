import { stat, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Walk up from this module's URL to locate package.json. Used by CLI commands
 *  that need the smith version at runtime (e.g. export, install --from). */
export async function readSmithVersion(): Promise<string> {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    try {
      const candidate = join(dir, "package.json");
      await stat(candidate);
      const raw = await readFile(candidate, "utf8");
      const v = (JSON.parse(raw) as { version?: unknown }).version;
      if (typeof v !== "string") {
        throw new Error("package.json has no string version field");
      }
      return v;
    } catch {}
    dir = dirname(dir);
  }
  throw new Error("could not locate package.json");
}
