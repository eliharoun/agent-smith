/**
 * Phase 2 route placeholders — all Phase 2 routes are now real except for
 * the in-editor `KnowledgeAgentRedirect`, which is itself a real component
 * (just lives here historically).
 *
 * Replaced (no longer in this file):
 *   - Skills, SkillNew, SkillEditor       → Task 23
 *   - Catalogs, CatalogRegister           → Task 24
 *   - RefreshHistory, RefreshHistoryIndex → Task 26
 *   - AtlassianSetup                      → Task 27
 *   - KnowledgeIndex                      → Task 28
 */
import { Navigate, useParams } from "react-router-dom";

/**
 * Redirects /knowledge/:agent → /agents/:agent?tab=knowledge so the
 * top-level nav and the agent editor's Knowledge tab share state. The
 * in-editor tab (Task 29) is the canonical knowledge editing surface;
 * /knowledge is just a landing/picker.
 */
export function KnowledgeAgentRedirect() {
  const { agent } = useParams<{ agent: string }>();
  if (!agent) return <Navigate to="/knowledge" replace />;
  return <Navigate to={`/agents/${agent}?tab=knowledge`} replace />;
}
