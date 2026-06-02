import type { FieldHelpEntry } from "./index";

/**
 * Help text for the install-matrix grid.
 */
export const installHelp: Record<string, FieldHelpEntry> = {
  "install.allowMissingCli": {
    help: "Force-write the bundle into a platform's config directory even if its CLI isn't on PATH yet. Useful for staging an install before installing the AI client itself.",
  },
};
