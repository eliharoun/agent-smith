import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ModelConfig, Platform, PutModelConfigBody } from "gui-shared";
import {
  OPENCODE_PROVIDER_PRECEDENCE,
  sortByOpenCodePrecedence,
} from "../../../../src/core/model-resolution/provider-table";
import {
  CURATED_FALLBACK_V0_6_0,
  TIER_PATTERNS,
} from "../../../../src/core/model-resolution/types";
import { parseEnvFile, upsertEnvLines } from "./dotenv-roundtrip";

/**
 * Per-platform auth as produced by detectAllPlatforms() in
 * src/io/auth/. Re-declared here as a structural type because gui/server
 * has rootDir:"src" — we can't directly import the type. The route
 * plumbs a live detector via dynamic import (same pattern as
 * getOpenCodeModels).
 */
export interface PlatformAuthLite {
  platform: Platform;
  cliInstalled: boolean;
  status: "authenticated" | "unauthenticated" | "cli-not-installed" | "unknown";
  detail?: string;
  availableModels?: string[];
}

export interface ModelConfigDeps {
  smithEnvPath: string;
  authJsonPath: string;
  getOpenCodeModels: () => Promise<string[] | undefined>;
  env: NodeJS.ProcessEnv;
  /**
   * Returns the per-platform auth matrix. Optional: when omitted, all
   * platforms default to `unknown` so the UI still renders something
   * useful. Production wires the live detectAllPlatforms() helper from
   * src/io/auth/index.ts via dynamic import.
   */
  detectAllPlatforms?: () => Promise<Record<Platform, PlatformAuthLite>>;
}

const PLATFORMS: Platform[] = ["opencode", "claude-code", "codex", "kiro"];
const TIERS = ["high", "balanced", "fast"] as const;

/**
 * Per-platform tier → model literal table for non-OpenCode platforms.
 * Mirrors the static mappings in
 * src/core/model-resolution/{claude-code,codex,kiro}.ts. OpenCode has its
 * own dynamic resolution via the provider-table.
 */
const STATIC_TIER_MAPS: Record<
  Exclude<Platform, "opencode">,
  Record<(typeof TIERS)[number], string>
> = {
  "claude-code": { high: "opus", balanced: "sonnet", fast: "haiku" },
  codex: { high: "gpt-5-codex", balanced: "gpt-5", fast: "gpt-5-mini" },
  kiro: {
    high: "claude-opus-4.6",
    balanced: "claude-sonnet-4.6",
    fast: "claude-haiku-4.5",
  },
};

export async function readModelConfig(deps: ModelConfigDeps): Promise<ModelConfig> {
  const detected = await detectProviders(deps);
  const envVars = await readEnvVars(deps.smithEnvPath);

  // Preference order
  const preferenceOrder = resolvePreferenceOrder(detected, envVars, deps.env);

  // Tier overrides (legacy: OpenCode-specific)
  const tierOverrides = {
    high: envVars.SMITH_TIER_HIGH ?? null,
    balanced: envVars.SMITH_TIER_BALANCED ?? null,
    fast: envVars.SMITH_TIER_FAST ?? null,
  };

  // Per-platform tier overrides. The opencode entry mirrors the legacy
  // SMITH_TIER_<TIER> vars; the others read SMITH_<PLATFORM>_TIER_<TIER>.
  const perPlatformTierOverrides = readPerPlatformTierOverrides(envVars);

  // Tier preview (legacy: OpenCode-specific)
  const live = await deps.getOpenCodeModels();
  const providers = preferenceOrder.map((p) => p.provider);
  const tierPreview = computeTierPreview(providers, tierOverrides, live);

  // Per-platform auth matrix
  const platforms = await readPlatformAuth(deps);

  // Per-platform tier matrix
  const tierMatrix = computeTierMatrix({
    platforms,
    perPlatformTierOverrides,
    legacyOpencodeOverrides: tierOverrides,
    opencodePreferences: providers,
    live,
  });

  return {
    detectedProviders: detected,
    preferenceOrder,
    tierPreview,
    tierOverrides,
    platforms,
    tierMatrix,
    perPlatformTierOverrides,
  };
}

export async function writeModelConfig(
  input: PutModelConfigBody,
  deps: ModelConfigDeps,
): Promise<void> {
  const existing = await readFileOrEmpty(deps.smithEnvPath);
  const updates: Record<string, string> = {};

  if (input.preferenceOrder) {
    updates.SMITH_MODEL_PROVIDERS = input.preferenceOrder.join(",");
  }
  if (input.tierOverrides) {
    for (const tier of TIERS) {
      const val = input.tierOverrides[tier];
      if (val) updates[`SMITH_TIER_${tier.toUpperCase()}`] = val;
    }
  }
  // Per-platform tier overrides. opencode entries map back to the
  // legacy SMITH_TIER_<TIER> for parity with the CLI.
  if (input.perPlatformTierOverrides) {
    for (const platform of PLATFORMS) {
      const ov = input.perPlatformTierOverrides[platform];
      if (!ov) continue;
      for (const tier of TIERS) {
        const val = ov[tier];
        if (!val) continue;
        const key =
          platform === "opencode"
            ? `SMITH_TIER_${tier.toUpperCase()}`
            : `SMITH_${platform === "claude-code" ? "CLAUDE" : platform.toUpperCase()}_TIER_${tier.toUpperCase()}`;
        updates[key] = val;
      }
    }
  }

  if (Object.keys(updates).length > 0) {
    const next = upsertEnvLines(existing, updates);
    await mkdir(dirname(deps.smithEnvPath), { recursive: true });
    await writeFile(deps.smithEnvPath, next, { mode: 0o600 });
  }
}

async function detectProviders(deps: ModelConfigDeps): Promise<string[]> {
  // Layer 1: auth.json — explicit credentials per provider.
  try {
    const raw = await readFile(deps.authJsonPath, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const keys = Object.keys(parsed).filter((k) => k.length > 0);
    if (keys.length > 0) return keys;
  } catch {
    /* missing or unparseable */
  }
  // Layer 2: infer from `opencode models` — picks up users who authed
  // via shell env vars / AWS credential chain / etc. (e.g.
  // amazon-bedrock) where auth.json isn't written. Mirrors the CLI's
  // detectAuthenticatedProviders fallback. Without this, the GUI
  // reports "// none detected" for users who have a live model list.
  try {
    const live = await deps.getOpenCodeModels();
    if (live && live.length > 0) {
      const set = new Set<string>();
      for (const id of live) {
        const idx = id.indexOf("/");
        if (idx > 0) set.add(id.slice(0, idx));
      }
      return [...set];
    }
  } catch {
    /* live fetch failed — return empty */
  }
  return [];
}

function resolvePreferenceOrder(
  detected: string[],
  envVars: Record<string, string>,
  processEnv: NodeJS.ProcessEnv,
): ModelConfig["preferenceOrder"] {
  // 1. Process env SMITH_MODEL_PROVIDERS
  const envProv = processEnv.SMITH_MODEL_PROVIDERS;
  if (envProv) {
    return envProv
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((provider) => ({ provider, source: "env" as const }));
  }
  // 2. .env file SMITH_MODEL_PROVIDERS
  const fileProv = envVars.SMITH_MODEL_PROVIDERS;
  if (fileProv) {
    return fileProv
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((provider) => ({ provider, source: "file" as const }));
  }
  // 3. Default: sort detected by precedence, or use full precedence list
  const sorted =
    detected.length > 0 ? sortByOpenCodePrecedence(detected) : [...OPENCODE_PROVIDER_PRECEDENCE];
  return sorted.map((provider) => ({ provider, source: "default" as const }));
}

function computeTierPreview(
  providers: string[],
  overrides: { high: string | null; balanced: string | null; fast: string | null },
  live: string[] | undefined,
): ModelConfig["tierPreview"] {
  const tiers = ["high", "balanced", "fast"] as const;
  return tiers.map((tier) => {
    // Override wins
    if (overrides[tier]) {
      return { tier, resolved: overrides[tier], source: "override" as const };
    }
    // Live resolution
    if (live) {
      const pattern = TIER_PATTERNS[tier];
      for (const provider of providers) {
        const prefix = `${provider}/`;
        const match = live.find(
          (id) => id.startsWith(prefix) && pattern.test(id.slice(prefix.length)),
        );
        if (match) return { tier, resolved: match, source: "live" as const };
      }
    }
    // Curated fallback
    const curated = CURATED_FALLBACK_V0_6_0[tier];
    if (!live) {
      return {
        tier,
        resolved: curated,
        source: "curated" as const,
        message: "opencode CLI unavailable",
      };
    }
    return { tier, resolved: null, source: "failed" as const, message: "no matching model found" };
  });
}

async function readEnvVars(path: string): Promise<Record<string, string>> {
  try {
    const raw = await readFile(path, "utf8");
    return parseEnvFile(raw);
  } catch {
    return {};
  }
}

async function readFileOrEmpty(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

async function readPlatformAuth(
  deps: ModelConfigDeps,
): Promise<Record<Platform, ModelConfig["platforms"][Platform]>> {
  if (!deps.detectAllPlatforms) {
    // No injected detector → fall back to a flat "unknown" matrix. The
    // UI renders this as "auth state could not be determined" and the
    // user can re-open the page once the GUI server has been restarted
    // with a wired detector.
    const acc = {} as Record<Platform, ModelConfig["platforms"][Platform]>;
    for (const p of PLATFORMS) {
      acc[p] = { cliInstalled: false, status: "unknown" };
    }
    return acc;
  }
  let raw: Record<Platform, PlatformAuthLite>;
  try {
    raw = await deps.detectAllPlatforms();
  } catch {
    const acc = {} as Record<Platform, ModelConfig["platforms"][Platform]>;
    for (const p of PLATFORMS) {
      acc[p] = { cliInstalled: false, status: "unknown" };
    }
    return acc;
  }
  const out = {} as Record<Platform, ModelConfig["platforms"][Platform]>;
  for (const p of PLATFORMS) {
    const a = raw[p];
    out[p] = {
      cliInstalled: a.cliInstalled,
      status: a.status,
      ...(a.detail !== undefined ? { detail: a.detail } : {}),
      ...(a.availableModels !== undefined ? { availableModels: a.availableModels } : {}),
    };
  }
  return out;
}

function readPerPlatformTierOverrides(
  envVars: Record<string, string>,
): ModelConfig["perPlatformTierOverrides"] {
  const out = {} as ModelConfig["perPlatformTierOverrides"];
  for (const platform of PLATFORMS) {
    out[platform] = {
      high: envVarForTier(envVars, platform, "high"),
      balanced: envVarForTier(envVars, platform, "balanced"),
      fast: envVarForTier(envVars, platform, "fast"),
    };
  }
  return out;
}

function envVarForTier(
  envVars: Record<string, string>,
  platform: Platform,
  tier: "high" | "balanced" | "fast",
): string | null {
  // OpenCode reads the legacy SMITH_TIER_<TIER> for back-compat.
  // Other platforms have their own SMITH_<PLATFORM>_TIER_<TIER>.
  if (platform === "opencode") {
    return envVars[`SMITH_TIER_${tier.toUpperCase()}`] ?? null;
  }
  const platformPart = platform === "claude-code" ? "CLAUDE" : platform.toUpperCase();
  return envVars[`SMITH_${platformPart}_TIER_${tier.toUpperCase()}`] ?? null;
}

interface TierMatrixInput {
  platforms: ModelConfig["platforms"];
  perPlatformTierOverrides: ModelConfig["perPlatformTierOverrides"];
  legacyOpencodeOverrides: ModelConfig["tierOverrides"];
  opencodePreferences: string[];
  live: string[] | undefined;
}

function computeTierMatrix(input: TierMatrixInput): ModelConfig["tierMatrix"] {
  return TIERS.map((tier) => {
    const perPlatform = {} as Record<Platform, string | null>;
    for (const platform of PLATFORMS) {
      perPlatform[platform] = resolvePlatformTier(platform, tier, input);
    }
    return { tier, perPlatform };
  });
}

function resolvePlatformTier(
  platform: Platform,
  tier: "high" | "balanced" | "fast",
  input: TierMatrixInput,
): string | null {
  // Per-platform env override wins (or, for opencode, the legacy
  // SMITH_TIER_<TIER>).
  const platformOverride = input.perPlatformTierOverrides[platform]?.[tier];
  if (platformOverride) return platformOverride;
  if (platform === "opencode") {
    const legacy = input.legacyOpencodeOverrides[tier];
    if (legacy) return legacy;
  }

  const auth = input.platforms[platform];
  if (auth.status === "cli-not-installed" || auth.status === "unauthenticated") {
    return null;
  }

  if (platform === "opencode") {
    // Walk the live model list looking for tier-pattern matches by
    // provider preference. Mirrors src/core/model-resolution/opencode.ts.
    if (input.live) {
      const pattern = TIER_PATTERNS[tier];
      for (const provider of input.opencodePreferences) {
        const prefix = `${provider}/`;
        const match = input.live.find(
          (id) => id.startsWith(prefix) && pattern.test(id.slice(prefix.length)),
        );
        if (match) return match;
      }
    }
    // Curated fallback if no live match.
    return CURATED_FALLBACK_V0_6_0[tier];
  }

  // claude-code: prefer the literal tier name when in availableModels;
  // else substitute the closest available family (mirrors
  // src/core/model-resolution/claude-code.ts).
  if (platform === "claude-code") {
    const want = STATIC_TIER_MAPS["claude-code"][tier];
    const available = auth.availableModels;
    if (!available || available.length === 0) return want;
    if (available.includes(want)) return want;
    // closest substitution: opus > sonnet > haiku for any tier.
    for (const candidate of ["opus", "sonnet", "haiku"]) {
      if (available.includes(candidate)) return candidate;
    }
    return want;
  }

  // codex / kiro: static tier table.
  return STATIC_TIER_MAPS[platform][tier];
}
