import type { Platform } from "gui-shared";
import { useCallback } from "react";
import { apiFetch } from "@/api/client";
import { useNotifications } from "@/hooks/useNotifications";

/**
 * Builds a "fire after a successful knowledge save" notifier shared by the
 * Add and Edit knowledge-source modals. After the modal's save path resolves,
 * the caller invokes the returned function with a verb ("Saved" /
 * "Knowledge source added") and a `reinstall` callback. The helper:
 *
 * 1. Fetches `/api/agents/:name/drift-check` directly (rather than relying on
 *    a tanstack-query refetch) so the result reflects the just-written
 *    config and isn't racing the cache invalidation that
 *    `useSaveAgentConfig.onSuccess` triggers.
 * 2. When drift is empty, fires a 3s `success` notification.
 * 3. When drift is non-empty, fires a sticky `info` notification with a
 *    "Re-install now" action that dispatches `reinstall(drifted)`.
 *
 * Both notifications use a shared `dedupKey` of `agent-saved:<agent>` so
 * rapid successive saves replace the existing toast in place rather than
 * stacking — the user only ever sees the latest save outcome.
 *
 * `reinstall` is the same callback the agent page's Re-install button calls
 * (lifted into the parent so the hook instance survives the modal's
 * unmount). The action is fire-and-forget here — the hook itself owns the
 * progress→success/error notification lifecycle.
 */
export function useSaveSuccessNotification(
  agent: string,
  reinstall: (targets: Platform[]) => void,
): (savedTitle: string) => Promise<void> {
  const { notify } = useNotifications();
  return useCallback(
    async (savedTitle: string) => {
      let drifted: Platform[] = [];
      try {
        const resp = await apiFetch<{ drifted: Platform[] }>(
          `/api/agents/${encodeURIComponent(agent)}/drift-check`,
        );
        drifted = resp.drifted ?? [];
      } catch {
        // A failed drift-check shouldn't block the save-success toast — fall
        // through with an empty drift list. The canonical "Saved." case is
        // still informative; the user can manually click Re-install if they
        // know they need to.
        drifted = [];
      }
      const dedupKey = `agent-saved:${agent}`;
      if (drifted.length === 0) {
        notify({
          kind: "success",
          title: `${savedTitle}.`,
          durationMs: 3000,
          dedupKey,
        });
      } else {
        notify({
          kind: "info",
          title: savedTitle,
          body: `Re-install required to apply on ${drifted.join(", ")}.`,
          durationMs: "sticky",
          actions: [
            {
              label: "Re-install now",
              onClick: () => reinstall(drifted),
              variant: "primary",
            },
          ],
          dedupKey,
        });
      }
    },
    [agent, notify, reinstall],
  );
}
