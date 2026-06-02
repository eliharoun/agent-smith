import type { FieldHelpEntry } from "./index";

/**
 * Help text for the install-time refresh-consent modal. Single key today,
 * but kept in its own namespace so future consent-related controls (e.g.
 * per-source consent) land in the same module.
 */
export const refreshConsentHelp: Record<string, FieldHelpEntry> = {
  "refreshConsent.platform": {
    help: "Granting lets smith refresh this agent's knowledge sources from inside <platform> (network fetches, git clones). You can revoke later from `smith doctor` or the Knowledge tab.",
  },
};
