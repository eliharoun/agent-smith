/**
 * Historic home of GUI route placeholders. All have shipped as real
 * components elsewhere; this file remains only as the home of
 * `KnowledgeAgentRedirect`, which is itself a real (non-placeholder)
 * component imported from App.tsx by file path.
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
