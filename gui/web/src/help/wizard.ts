import type { FieldHelpEntry } from "./index";

/**
 * Help text for the agent-create wizard. Reserved namespace; populated as the
 * wizard's controls adopt the FieldHelp system.
 */
export const wizardHelp: Record<string, FieldHelpEntry> = {
  "wizard.template": {
    help: "Starter persona to clone for the new agent. Pick the closest match to your intended use; you can edit identity/expertise/soul/user after creation.",
  },
};
