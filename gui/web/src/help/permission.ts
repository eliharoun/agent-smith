import type { FieldHelpEntry } from "./index";

/**
 * Help text for the agent-permissions view. Today the view is read-only; the
 * tooltip clarifies what each action chip means so users understand the JSON
 * they'd edit on disk.
 */
export const permissionHelp: Record<string, FieldHelpEntry> = {
  "permission.action": {
    help: "allow = the agent can run it without prompting. ask = the AI client prompts the user each time. deny = blocked outright. Keys can be bare actions or per-pattern overrides.",
  },
};
