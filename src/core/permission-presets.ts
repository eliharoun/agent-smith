import type { PermissionConfig } from "./types";

export const PRESET_NAMES = ["read-only", "read-edit", "full"] as const;
export type PresetName = (typeof PRESET_NAMES)[number];

export const PRESETS = {
  "read-only": {
    read: "allow",
    glob: "allow",
    grep: "allow",
    list: "allow",
    lsp: "allow",
    edit: "deny",
    bash: "deny",
    task: "deny",
    webfetch: "deny",
    websearch: "deny",
    external_directory: "deny",
    skill: "allow",
  },
  "read-edit": {
    read: "allow",
    glob: "allow",
    grep: "allow",
    list: "allow",
    lsp: "allow",
    edit: "allow",
    bash: "deny",
    task: "allow",
    webfetch: "deny",
    websearch: "deny",
    external_directory: "deny",
    skill: "allow",
  },
  full: {
    read: "allow",
    glob: "allow",
    grep: "allow",
    list: "allow",
    lsp: "allow",
    edit: "allow",
    bash: "allow",
    task: "allow",
    webfetch: "allow",
    websearch: "allow",
    external_directory: "allow",
    skill: "allow",
  },
} as const satisfies Record<PresetName, PermissionConfig>;

export function expandPreset(name: PresetName): PermissionConfig {
  if (!PRESET_NAMES.includes(name)) {
    throw new Error(`Unknown permission preset: ${name}. Valid: ${PRESET_NAMES.join(", ")}`);
  }
  return structuredClone(PRESETS[name]);
}
