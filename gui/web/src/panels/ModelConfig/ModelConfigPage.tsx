import type { Platform } from "gui-shared";
import { useState } from "react";
import { useModelConfig, useUpdateModelConfig } from "@/hooks/useModelConfig";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Chip } from "@/ui/Chip";

const PLATFORMS: Platform[] = ["opencode", "claude-code", "codex", "kiro"];
const PLATFORM_LABELS: Record<Platform, string> = {
  opencode: "OpenCode",
  "claude-code": "Claude Code",
  codex: "Codex",
  kiro: "Kiro",
};
const TIERS = ["high", "balanced", "fast"] as const;

type PerPlatformOverrideDraft = Record<Platform, Record<(typeof TIERS)[number], string>>;

function emptyDraft(): PerPlatformOverrideDraft {
  return {
    opencode: { high: "", balanced: "", fast: "" },
    "claude-code": { high: "", balanced: "", fast: "" },
    codex: { high: "", balanced: "", fast: "" },
    kiro: { high: "", balanced: "", fast: "" },
  };
}

export function ModelConfigPage() {
  const config = useModelConfig();
  const update = useUpdateModelConfig();
  const [order, setOrder] = useState<string[] | null>(null);
  const [overrides, setOverrides] = useState<PerPlatformOverrideDraft>(emptyDraft());
  const [dirty, setDirty] = useState(false);

  // Seed local state from server.
  if (config.data && order === null) {
    setOrder(config.data.preferenceOrder.map((p) => p.provider));
    const draft = emptyDraft();
    for (const platform of PLATFORMS) {
      const ov = config.data.perPlatformTierOverrides?.[platform];
      if (!ov) continue;
      for (const tier of TIERS) {
        draft[platform][tier] = ov[tier] ?? "";
      }
    }
    setOverrides(draft);
  }

  if (config.isLoading) {
    return (
      <Card>
        <div className="font-mono text-sm text-matrix-body">// loading…</div>
      </Card>
    );
  }
  if (config.isError) {
    return (
      <Card>
        <div className="font-mono text-sm text-matrix-red">
          // failed to load — {(config.error as Error).message}
        </div>
        <Button variant="ghost" onClick={() => config.refetch()}>
          retry
        </Button>
      </Card>
    );
  }

  const data = config.data!;
  const providers = order ?? data.preferenceOrder.map((p) => p.provider);
  const visiblePlatforms = PLATFORMS.filter(
    (p) => data.platforms?.[p]?.status !== "cli-not-installed",
  );

  function moveUp(i: number) {
    if (i === 0) return;
    const next = [...providers];
    [next[i - 1], next[i]] = [next[i]!, next[i - 1]!];
    setOrder(next);
    setDirty(true);
  }

  function moveDown(i: number) {
    if (i === providers.length - 1) return;
    const next = [...providers];
    [next[i], next[i + 1]] = [next[i + 1]!, next[i]!];
    setOrder(next);
    setDirty(true);
  }

  function setOverride(platform: Platform, tier: (typeof TIERS)[number], value: string) {
    setOverrides((prev) => ({
      ...prev,
      [platform]: { ...prev[platform], [tier]: value },
    }));
    setDirty(true);
  }

  function onSave() {
    type Body = NonNullable<Parameters<typeof update.mutate>[0]["perPlatformTierOverrides"]>;
    const perPlatformTierOverrides = {} as Body;
    for (const platform of PLATFORMS) {
      const ov = overrides[platform];
      perPlatformTierOverrides[platform] = {
        high: ov.high || null,
        balanced: ov.balanced || null,
        fast: ov.fast || null,
      };
    }
    update.mutate(
      { preferenceOrder: providers, perPlatformTierOverrides },
      {
        onSuccess: () => {
          setDirty(false);
          setOrder(null);
        },
      },
    );
  }

  // Derive a tier→platform→string|null lookup for grid rendering.
  const tierLookup: Record<(typeof TIERS)[number], Record<Platform, string | null>> = {
    high: { opencode: null, "claude-code": null, codex: null, kiro: null },
    balanced: { opencode: null, "claude-code": null, codex: null, kiro: null },
    fast: { opencode: null, "claude-code": null, codex: null, kiro: null },
  };
  if (data.tierMatrix) {
    for (const row of data.tierMatrix) {
      for (const platform of PLATFORMS) {
        tierLookup[row.tier][platform] = row.perPlatform[platform] ?? null;
      }
    }
  }

  return (
    <>
      {/* Card 1: Platform readiness */}
      <Card>
        <div className="font-mono text-[10px] uppercase tracking-widest text-matrix-green-muted mb-3">
          // platforms — installed and authenticated?
        </div>
        <div className="font-mono text-xs text-matrix-body mb-3">
          Each row is one of the four agent runtimes smith can render to. `authenticated`
          means smith can resolve a model for that platform right now; `unauthenticated`
          means the CLI is on PATH but the credential is missing or expired;
          `not installed` means the CLI binary isn't on PATH.
        </div>
        <ul className="space-y-1.5">
          {PLATFORMS.map((p) => {
            const auth = data.platforms?.[p];
            const status = auth?.status ?? "unknown";
            const tone =
              status === "authenticated"
                ? "green"
                : status === "unauthenticated"
                  ? "amber"
                  : status === "cli-not-installed"
                    ? "neutral"
                    : "amber";
            return (
              <li key={p} className="flex items-center gap-3 font-mono text-sm">
                <span className="text-matrix-green w-32">{PLATFORM_LABELS[p]}</span>
                <Chip tone={tone}>{status}</Chip>
                {auth?.detail && (
                  <span className="text-matrix-body text-xs">{auth.detail}</span>
                )}
              </li>
            );
          })}
        </ul>
      </Card>

      {/* Card 2: OpenCode provider preference (advanced; only meaningful for OpenCode) */}
      {visiblePlatforms.includes("opencode") && (
        <Card>
          <div className="font-mono text-[10px] uppercase tracking-widest text-matrix-green-muted mb-3">
            // opencode: which provider is tried first
          </div>
          <div className="font-mono text-xs text-matrix-body mb-3 leading-relaxed">
            OpenCode aggregates models from multiple providers (anthropic, github-copilot,
            openrouter, amazon-bedrock, google-vertex-ai, openai). When you ask for a model
            tier (high/balanced/fast) without pinning an exact model, smith walks this list
            top-to-bottom and picks the first provider whose model list contains a match.
            Reorder to prefer one provider over another.
            <br />
            <br />
            Other platforms aren't affected by this list — Claude Code, Codex, and Kiro each
            resolve tiers via their own runtime, not through a provider table.
          </div>
          <ul className="space-y-1 mb-3">
            {providers.map((p, i) => (
              <li
                key={p}
                className="flex items-center gap-2 font-mono text-sm text-matrix-green"
              >
                <Button variant="ghost" disabled={i === 0} onClick={() => moveUp(i)}>
                  ↑
                </Button>
                <Button
                  variant="ghost"
                  disabled={i === providers.length - 1}
                  onClick={() => moveDown(i)}
                >
                  ↓
                </Button>
                <span>{p}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Card 3: Tier resolution matrix */}
      <Card>
        <div className="font-mono text-[10px] uppercase tracking-widest text-matrix-green-muted mb-3">
          // tier resolution preview
        </div>
        <div className="font-mono text-xs text-matrix-body mb-2">
          What each platform's resolver would emit for each tier. — means the platform
          can't resolve (CLI absent or unauthenticated).
        </div>
        <table className="w-full font-mono text-xs">
          <thead>
            <tr>
              <th className="text-left text-matrix-green-muted py-1">tier</th>
              {visiblePlatforms.map((p) => (
                <th key={p} className="text-left text-matrix-green-muted py-1 px-2">
                  {PLATFORM_LABELS[p]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {TIERS.map((tier) => (
              <tr key={tier}>
                <td className="text-matrix-green py-1">{tier}</td>
                {visiblePlatforms.map((p) => {
                  const v = tierLookup[tier][p];
                  return (
                    <td
                      key={p}
                      className={`py-1 px-2 ${
                        v ? "text-matrix-green" : "text-matrix-body"
                      }`}
                    >
                      {v ?? "—"}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {/* Card 4: Per-platform tier overrides */}
      <Card>
        <div className="font-mono text-[10px] uppercase tracking-widest text-matrix-green-muted mb-3">
          // pin a specific model
        </div>
        <div className="font-mono text-xs text-matrix-body mb-3 leading-relaxed">
          Override what each (platform, tier) pair resolves to. The placeholder text in
          each input is what would be used today; type a value to pin it explicitly. Saved
          to your .env file as SMITH_TIER_&lt;TIER&gt; (OpenCode) or
          SMITH_&lt;PLATFORM&gt;_TIER_&lt;TIER&gt; (others). Leave blank to clear.
        </div>
        <div className="space-y-4">
          {visiblePlatforms.map((platform) => (
            <div key={platform}>
              <div className="font-mono text-xs text-matrix-green mb-1.5">
                {PLATFORM_LABELS[platform]}
              </div>
              <div className="space-y-1">
                {TIERS.map((tier) => (
                  <div key={tier} className="flex items-center gap-2">
                    <label className="font-mono text-[11px] text-matrix-body w-20">
                      {tier}:
                    </label>
                    <input
                      className="flex-1 bg-black border border-matrix-line px-2 py-1 font-mono text-sm text-matrix-green"
                      value={overrides[platform][tier]}
                      onChange={(e) => setOverride(platform, tier, e.target.value)}
                      placeholder={tierLookup[tier][platform] ?? ""}
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <Button
          disabled={!dirty || update.isPending}
          onClick={onSave}
          // bun-test mock seam: keep classes simple to avoid breaking
          // existing assertions on the save button.
        >
          {update.isPending ? "saving…" : "save"}
        </Button>
      </Card>
    </>
  );
}
