import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import pc from "picocolors";
import { parseEnvFile, upsertEnvLines } from "../../io/dotenv-roundtrip";
import { detectAuthenticatedProviders } from "../../io/opencode-auth";
import { stateHome } from "../../io/state-home";

const KEY_MAP: Record<string, string> = {
  "model.providers": "SMITH_MODEL_PROVIDERS",
  "model.tier.high": "SMITH_TIER_HIGH",
  "model.tier.balanced": "SMITH_TIER_BALANCED",
  "model.tier.fast": "SMITH_TIER_FAST",
};

const VALID_KEYS = Object.keys(KEY_MAP);

export interface ConfigCliDeps {
  print?: (s: string) => void;
  printErr?: (s: string) => void;
  envPath?: string;
  detectProviders?: () => Promise<string[]>;
}

function resolveEnvPath(deps: ConfigCliDeps): string {
  return deps.envPath ?? join(stateHome(), ".env");
}

function envVarFor(key: string): string {
  return KEY_MAP[key] ?? "";
}

async function readEnv(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

function invalidKeyError(key: string, deps: ConfigCliDeps): number {
  const printErr = deps.printErr ?? console.error;
  printErr(`Unknown config key '${key}'. Valid keys:\n  ${VALID_KEYS.join("\n  ")}`);
  return 1;
}

export async function runConfigGetCli(
  key: string | undefined,
  deps: ConfigCliDeps = {},
): Promise<number> {
  const print = deps.print ?? console.log;
  const envPath = resolveEnvPath(deps);

  if (key !== undefined) {
    if (!(key in KEY_MAP)) return invalidKeyError(key, deps);
    const raw = await readEnv(envPath);
    const parsed = parseEnvFile(raw);
    const envVar = envVarFor(key);
    const value = parsed[envVar];
    print(value ?? "(unset)");
    return 0;
  }

  // Full config overview
  const detect = deps.detectProviders ?? (() => detectAuthenticatedProviders());
  const providers = await detect();
  const raw = await readEnv(envPath);
  const parsed = parseEnvFile(raw);

  const lines: string[] = [];
  lines.push(pc.bold("Model resolution"));

  // Detected providers
  lines.push(`  Detected providers:`);
  lines.push(`    ${providers.length > 0 ? providers.join(", ") : "(none)"}`);

  // Preference order
  lines.push(`  Preference order:`);
  const envProviders = parsed.SMITH_MODEL_PROVIDERS;
  const ordered = envProviders ? envProviders.split(",").map((s) => s.trim()) : providers;
  const source = envProviders ? "(from .env)" : "(from default)";
  ordered.forEach((p, i) => {
    const annotation = i === 0 ? `  ${source}` : "";
    lines.push(`    ${i + 1}. ${p}${annotation}`);
  });

  // Per-tier overrides
  lines.push(`  Per-tier overrides:`);
  for (const k of ["model.tier.high", "model.tier.balanced", "model.tier.fast"]) {
    const envVar = envVarFor(k);
    const val = parsed[envVar];
    const display = val ?? "(unset)";
    lines.push(`    ${k.padEnd(22)}${display}`);
  }

  print(lines.join("\n"));
  return 0;
}

export async function runConfigSetCli(
  key: string,
  value: string,
  deps: ConfigCliDeps = {},
): Promise<number> {
  if (!(key in KEY_MAP)) return invalidKeyError(key, deps);
  const envPath = resolveEnvPath(deps);
  const envVar = envVarFor(key);

  await mkdir(join(envPath, ".."), { recursive: true });
  const raw = await readEnv(envPath);
  const updated = upsertEnvLines(raw, { [envVar]: value });
  await writeFile(envPath, updated);

  const print = deps.print ?? console.log;
  print(`${key} = ${value}`);
  return 0;
}

export async function runConfigUnsetCli(key: string, deps: ConfigCliDeps = {}): Promise<number> {
  if (!(key in KEY_MAP)) return invalidKeyError(key, deps);
  const envPath = resolveEnvPath(deps);
  const envVar = envVarFor(key);

  const raw = await readEnv(envPath);
  if (raw.length === 0) return 0; // nothing to unset
  const updated = upsertEnvLines(raw, { [envVar]: null });
  await mkdir(join(envPath, ".."), { recursive: true });
  await writeFile(envPath, updated);
  return 0;
}
