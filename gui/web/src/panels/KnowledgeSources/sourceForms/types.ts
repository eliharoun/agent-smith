import type { JobRequest } from "gui-shared";

/**
 * The shape returned by every source form. The modal turns this into a
 * `knowledge.add` JobRequest and dispatches via useStartJob.
 *
 * Optional fields are explicitly typed so forms can omit them; the modal
 * compacts undefineds when building the request.
 */
export type KnowledgeAddRequest = Extract<JobRequest, { command: "knowledge.add" }>;

export interface SubmittedVia {
  /** MCP server name picked from the routing dropdown. */
  server: string;
  /** Tool name on that server (auto-selected if exactly one URL-shaped tool). */
  tool: string;
  /**
   * True when the picked server isn't already in the bundle's `mcpServers[]`
   * — the modal extends the array on save so the install pipeline picks
   * up the new dependency on the next materialize. Mirrors `serverWasAdded`
   * in the CLI's `pickViaInteractively`.
   */
  serverWasAdded: boolean;
}

export interface FormSubmit {
  request: Omit<KnowledgeAddRequest, "command" | "agent">;
  /** Validation messages keyed by field name; empty object = valid. */
  errors?: Record<string, string>;
  /**
   * Optional routing pick. Present when the URL-source form's routing
   * dropdown landed on an MCP server. The modal writes this to the source's
   * `via:` block via the agent-config PUT path (NOT the knowledge.add job,
   * which doesn't accept a via flag) and extends `mcpServers[]` if needed.
   */
  via?: SubmittedVia;
}

export type SourceFormProps = {
  /** Agent name — only the URL form uses it (to fetch the picker payload). */
  agent?: string;
  /** Existing source ids in the agent's manifest (for unique-id validation). */
  existingIds: string[];
  /** Called whenever the form is valid and the user hits Save in the modal. */
  onSubmit: (s: FormSubmit) => void;
  /** Form-id used so the modal's Save button can submit via form element. */
  formId: string;
};
