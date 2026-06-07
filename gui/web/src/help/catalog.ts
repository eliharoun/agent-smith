import type { FieldHelpEntry } from "./index";

/**
 * Help text for the catalog-register form (agent + skill registries).
 */
export const catalogHelp: Record<string, FieldHelpEntry> = {
  "catalog.kind": {
    help: "Where this catalog lives. user-global = `~/.config/agent-smith` (your machine). project = repo-local `.agent-smith/`. registered = a git-cloned bundle. Skill catalogs add `team-shared` for org-wide bundles.",
  },
  "catalog.skipGitCheck": {
    help: "Bypass the 'is this a git repo with a remote?' verification. Use only for local-only catalogs you don't intend to share — otherwise this lets you register catalogs that can't be cloned by teammates.",
  },
  "catalog.allowEmpty": {
    help: "Register the catalog even if it currently has zero agents/skills. Useful when bootstrapping a new repo before the first bundle lands.",
  },
  "catalog.path": {
    help: "A folder ALREADY on your machine (e.g. ~/my-agents or /abs/path/to/repo). smith scans it for bundles and registers it in place — it does NOT download anything. To pull from a git URL instead, close this and use 'Install from URL'.",
  },
  "catalog.gitRemote": {
    help: "Optional: the git remote this local folder should sync with. Leave blank to auto-detect from the folder's own `git remote`. Set it only to override (e.g. the folder is a worktree or fork of a different upstream).",
  },
};
