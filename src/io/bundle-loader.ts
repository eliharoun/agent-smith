import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseConfig } from "../core/config-schema";
import { SmithError } from "../core/smith-error";
import { toMessage } from "../core/to-message";
import type { AgentBundle, Source } from "../core/types";
import { classifyFsError } from "./fs-error";

export interface LoadBundleOptions {
  /** Used when USER.md is absent from the bundle directory. */
  canonicalUserPath?: string;
}

async function readMaybe(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw classifyFsError(err, path, "read");
  }
}

export async function loadBundle(
  bundlePath: string,
  source: Source,
  options: LoadBundleOptions = {},
): Promise<AgentBundle> {
  const configPath = join(bundlePath, "agent.config.json");
  const configRaw = await readMaybe(configPath);
  if (configRaw === null) {
    throw new SmithError({
      code: "config-missing",
      path: configPath,
      suggestedCommand: "smith agent init <name>",
    });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(configRaw);
  } catch (err) {
    throw new SmithError(
      {
        code: "validation-failed",
        what: "agent.config.json",
        reasons: [`${configPath}: not valid JSON: ${toMessage(err)}`],
      },
      { cause: err },
    );
  }
  const result = parseConfig(parsed);
  if (!result.success) {
    throw new SmithError({
      code: "validation-failed",
      what: "agent.config.json",
      reasons: result.errors,
    });
  }

  const identity = (await readMaybe(join(bundlePath, "IDENTITY.md"))) ?? "";
  const expertise = (await readMaybe(join(bundlePath, "EXPERTISE.md"))) ?? "";
  const soul = (await readMaybe(join(bundlePath, "SOUL.md"))) ?? "";

  // USER.md: readFile resolves symlinks transparently. If absent, fall back
  // to the canonical user file path if provided.
  let user = await readMaybe(join(bundlePath, "USER.md"));
  if (user === null && options.canonicalUserPath) {
    user = await readMaybe(options.canonicalUserPath);
  }
  if (user === null) user = "";

  return {
    config: result.data,
    source,
    bundlePath,
    files: { identity, expertise, soul, user },
  };
}
