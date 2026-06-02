import type { FieldHelpEntry } from "./index";

/**
 * Help text for the Model Config page.
 *
 * Style rules match `knowledge.ts`. Card-level prose already exists in
 * ModelConfigPage; these tooltips add row-level specifics (env-var names,
 * placeholder semantics, status meanings) the prose doesn't restate.
 */
export const modelHelp: Record<string, FieldHelpEntry> = {
  "model.platformStatus": {
    help: "authenticated = smith can resolve a model right now. unauthenticated = CLI is on PATH but its credentials are missing/expired. cli-not-installed = the CLI binary isn't on PATH.",
  },
  "model.providerPreference": {
    help: "OpenCode-only. When a tier (high/balanced/fast) isn't pinned to a model, smith walks this list top-down and picks the first provider that exposes a matching model. Reorder to prefer one provider over another.",
  },
  "model.tierOverride": {
    help: "Pin an exact model id for this (platform, tier) pair. Placeholder = what would resolve right now. Persisted to `.env` as `SMITH_TIER_<TIER>` (OpenCode) or `SMITH_<PLATFORM>_TIER_<TIER>` (others). Blank = clear.",
  },
};
