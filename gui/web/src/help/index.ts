import { agentHelp } from "./agent";
import { catalogHelp } from "./catalog";
import { daemonHelp } from "./daemon";
import { installHelp } from "./install";
import { knowledgeHelp } from "./knowledge";
import { modelHelp } from "./model";
import { permissionHelp } from "./permission";
import { refreshConsentHelp } from "./refreshConsent";
import { wizardHelp } from "./wizard";

/**
 * Field-help registry. Keys are canonical paths (e.g. `knowledge.delivery`,
 * `knowledge.retrieval.mode`) so they line up with on-disk config shape.
 *
 * Centralised by design — UI components stay clean and copy lives in one place
 * for easy review/translation. Add a new namespace by importing its bundle
 * here (e.g. `agent.*` for AgentEditorTabs, `install.*` for the matrix grid).
 */

export interface FieldHelpEntry {
  /** Plain-text help body. Tooltip preserves whitespace, so `\n` works. */
  help: string;
}

const REGISTRY: Record<string, FieldHelpEntry> = {
  ...knowledgeHelp,
  ...agentHelp,
  ...modelHelp,
  ...refreshConsentHelp,
  ...catalogHelp,
  ...permissionHelp,
  ...installHelp,
  ...daemonHelp,
  ...wizardHelp,
};

export function getFieldHelp(fieldId: string): FieldHelpEntry | undefined {
  return REGISTRY[fieldId];
}
