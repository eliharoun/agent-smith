import { useState } from "react";
import { Button } from "@/ui/Button";

interface Props {
  agent: string;
  onAuthorizeAndRefresh: () => void;
  /**
   * Disables the "authorize and refresh" button. Used while platform
   * detection is still loading so the click can't fire with an empty
   * platforms list (which would silently skip granting consent).
   */
  disabled?: boolean;
}

/**
 * Yellow banner shown when AgentKnowledgeView.consent is undefined. Dismiss
 * hides the banner locally for the session only; the consent state on disk
 * is unchanged.
 */
export function RefreshConsentBanner({ agent, onAuthorizeAndRefresh, disabled }: Props) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  return (
    <div className="border border-matrix-amber bg-black/40 px-3 py-2 mb-3 flex items-center justify-between gap-3">
      <div className="font-mono text-xs text-matrix-amber">
        ⚠ knowledge refresh has not been authorized for{" "}
        <span className="text-matrix-body">{agent}</span>. refreshes run with the agent&rsquo;s
        permissions and may execute network requests, git fetches, or read local files.
      </div>
      <div className="flex gap-2 shrink-0">
        <Button variant="ghost" onClick={() => setDismissed(true)}>
          dismiss
        </Button>
        <Button onClick={onAuthorizeAndRefresh} disabled={disabled}>
          authorize and refresh
        </Button>
      </div>
    </div>
  );
}
