import type { FieldHelpEntry } from "./index";

/**
 * Help text for the agent-editor surfaces (AgentTargetsForm,
 * KnowledgeSources MCP toggle).
 *
 * Style rules match `knowledge.ts`:
 *   - 1–3 sentences, plain English, ≤ 280 chars.
 *   - No marketing prose. Explain WHAT it does + WHEN to use it.
 *   - Use \n to separate logical paragraphs; the Tooltip preserves whitespace.
 */
export const agentHelp: Record<string, FieldHelpEntry> = {
  "agent.targets": {
    help: "Which AI-client runtimes this agent renders to. Saving here only edits the bundle; you still need to install on each newly-checked target. The 'installed' chip reflects what's actually deployed.",
  },
  "agent.modelTier": {
    help: "How smart vs. how cheap. high = opus-class, balanced = sonnet-class, fast = haiku-class. inherit = use whatever the platform's CLI defaults to. Resolves per platform via Settings → Model; needs re-install to apply.",
  },
  "agent.refreshHooksPerPlatform": {
    help: "Lets the AI client re-pull this agent's network knowledge sources at session start. Off by default for safety — only flip on for trusted sources you want auto-updated.",
  },
  "agent.mcpToggle": {
    help: "When ON, this agent declares the bundled `agent-smith-knowledge` MCP server. smith writes spawn config into each AI client's MCP file (Claude Code, OpenCode, Codex, Kiro) so `knowledge.search` / `knowledge.fetch` are available at session start.",
  },
};
