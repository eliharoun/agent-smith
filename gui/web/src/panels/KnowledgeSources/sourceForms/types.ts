import type { JobRequest } from "gui-shared";

/**
 * The shape returned by every source form. The modal turns this into a
 * `knowledge.add` JobRequest and dispatches via useStartJob.
 *
 * Optional fields are explicitly typed so forms can omit them; the modal
 * compacts undefineds when building the request.
 */
export type KnowledgeAddRequest = Extract<JobRequest, { command: "knowledge.add" }>;

export interface FormSubmit {
  request: Omit<KnowledgeAddRequest, "command" | "agent">;
  /** Validation messages keyed by field name; empty object = valid. */
  errors?: Record<string, string>;
}

export type SourceFormProps = {
  /** Existing source ids in the agent's manifest (for unique-id validation). */
  existingIds: string[];
  /** Called whenever the form is valid and the user hits Save in the modal. */
  onSubmit: (s: FormSubmit) => void;
  /** Form-id used so the modal's Save button can submit via form element. */
  formId: string;
};
