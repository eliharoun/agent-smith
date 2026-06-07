import { useState } from "react";

/**
 * Top-of-page banner shown only when the GUI server reports it is running from
 * a maintainer's clone of the smith repo (`/api/status` → `cloneMode: true`).
 * In clone mode, editing protected bundles is allowed but writes to the repo
 * source — this sets that expectation. Dismissable for the browser session.
 */
const DISMISS_KEY = "smith.cloneBanner.dismissed";

export function CloneModeBanner({ active }: { active: boolean }) {
  const [dismissed, setDismissed] = useState(
    () => typeof sessionStorage !== "undefined" && sessionStorage.getItem(DISMISS_KEY) === "1",
  );
  if (!active || dismissed) return null;
  return (
    <div className="flex items-center justify-between border-b border-matrix-amber bg-matrix-amber/10 px-4 py-2 font-mono text-xs text-matrix-amber">
      <span>
        <strong className="uppercase tracking-widest">Clone mode:</strong> editing protected
        bundles is allowed, but mutations write to the smith repo.
      </span>
      <button
        type="button"
        onClick={() => {
          if (typeof sessionStorage !== "undefined") sessionStorage.setItem(DISMISS_KEY, "1");
          setDismissed(true);
        }}
        className="ml-4 shrink-0 underline hover:text-matrix-amber/80"
      >
        Don't show again this session
      </button>
    </div>
  );
}
