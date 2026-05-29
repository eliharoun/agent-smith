import type { ZodType } from "zod";
import type { InitAgentOpts } from "./commands/init-agent";
import { CanonicalConfigSchema } from "../core/config-schema";
import { expandPreset, PRESET_NAMES, type PresetName } from "../core/permission-presets";
import { SmithError } from "../core/smith-error";
import { toMessage } from "../core/to-message";

/**
 * Validate a CLI string flag against a zod schema sourced from
 * `CanonicalConfigSchema.shape`. On failure, throw a usage-error
 * SmithError that names the flag.
 *
 * `validHint` is a hand-written "Valid: ..." trailer appended to the
 * error message. Zod's own enum issue messages are not great
 * ("Invalid option: expected one of ...") so the trailer is sourced
 * from the canonical schema field at the call site.
 */
function parseFlagOrFail<T>(flag: string, schema: ZodType<T>, raw: unknown, validHint: string): T {
  const result = schema.safeParse(raw);
  if (!result.success) {
    const detail = result.error.issues.map((i) => i.message).join("; ");
    throw new SmithError({
      code: "usage-error",
      message: `Invalid ${flag}: ${detail}. ${validHint}`.trimEnd(),
    });
  }
  return result.data;
}

/**
 * Build an `InitAgentOpts` from commander's raw `Record<string, string | undefined>`.
 *
 * Each field that maps onto a branded canonical type is validated against the
 * matching `CanonicalConfigSchema.shape.<field>` so a typo fails fast at the CLI
 * boundary with a message that names the offending flag, rather than surfacing
 * later as a confusing schema error inside `init-agent`.
 *
 * Pure function — no I/O, no globals. Tested in isolation.
 */
export function parseInitAgentFlags(raw: Record<string, string | undefined>): InitAgentOpts {
  const opts: InitAgentOpts = {};

  if (raw.description) opts.description = raw.description;

  if (raw.targets) {
    const split = raw.targets
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    opts.targets = parseFlagOrFail(
      "--targets",
      CanonicalConfigSchema.shape.targets,
      split,
      "Valid: opencode, claude-code, codex.",
    );
  }

  if (raw.modelTier) {
    opts.modelTier = parseFlagOrFail(
      "--model-tier",
      CanonicalConfigSchema.shape.modelTier,
      raw.modelTier,
      "Valid: high, balanced, fast, inherit (aliases: opus, sonnet, haiku).",
    );
  }

  if (raw.mode) {
    opts.mode = parseFlagOrFail(
      "--mode",
      CanonicalConfigSchema.shape.mode,
      raw.mode,
      "Valid: primary, subagent, all.",
    );
  }

  // --permission-json takes precedence over --permission (preset).
  if (raw.permissionJson) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.permissionJson);
    } catch (err) {
      throw new SmithError({
        code: "usage-error",
        message: `Invalid --permission-json: ${toMessage(err)}`,
      });
    }
    const result = CanonicalConfigSchema.shape.permission.safeParse(parsed);
    if (!result.success) {
      const detail = result.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ");
      throw new SmithError({
        code: "usage-error",
        message: `Invalid --permission-json: ${detail}`,
      });
    }
    // Schema is `.optional()` so result.data is `T | undefined`, but we just
    // parsed a non-undefined input so the runtime value is always present.
    if (result.data !== undefined) opts.permission = result.data;
  } else if (raw.permission) {
    if (!PRESET_NAMES.includes(raw.permission as PresetName)) {
      throw new SmithError({
        code: "usage-error",
        message: `Invalid --permission: ${raw.permission}. Valid presets: ${PRESET_NAMES.join(", ")}`,
      });
    }
    opts.permission = expandPreset(raw.permission as PresetName);
  }

  if (raw.mcpServers) opts.mcpServers = raw.mcpServers.split(",");
  if (raw.skills) opts.skills = raw.skills.split(",");

  if (raw.requiresSkills) {
    opts.requiresSkills = raw.requiresSkills
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map((entry) => {
        const slash = entry.indexOf("/");
        if (slash === -1) return { name: entry };
        return {
          catalog: entry.slice(0, slash),
          name: entry.slice(slash + 1),
        };
      });
  }

  return opts;
}
