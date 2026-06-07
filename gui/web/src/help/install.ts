import type { FieldHelpEntry } from "./index";

/**
 * Help text for the install-matrix grid.
 */
export const installHelp: Record<string, FieldHelpEntry> = {
  "install.allowMissingCli": {
    help: "Force-write the bundle into a platform's config directory even if its CLI isn't on PATH yet. Useful for staging an install before installing the AI client itself.",
  },
  "install.source": {
    help: "Any of: a git URL (https://github.com/owner/repo or git@github.com:owner/repo), a local folder (~/ or /abs), or a .smith-bundle.tgz archive. smith reads it and lists what's inside. GitHub branch links (…/tree/<branch>) work too — smith uses that branch.",
  },
  "install.gitRef": {
    help: "Which version to fetch: a branch (main), tag (v1.2.3), or commit SHA. Leave blank to use the repo's default branch. Ignored for local-folder and archive sources.",
  },
  "install.smartInput": {
    help: "Paste anything: a git URL, a GitHub link, a local folder path, or a .smith-bundle.tgz file. smith auto-detects the kind and takes you to the right step.",
  },
  "install.skillSmartInput": {
    help: "Paste a git URL, GitHub link, local folder, .tgz archive, or a catalog/skill reference like `default/tdd` (the `tdd` skill from your `default` catalog). smith auto-detects the kind.",
  },
};
