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
 *
 * When the just-saved change toggled a source's retrieval mode to or from
 * `hybrid` (signalled via the `hybridRestart` option), the helper ALSO fires a
 * separate sticky `info` toast advising the user to restart the knowledge MCP server:
 * the `serve` process reads the index and loads the embedder once at spawn,
 * the AI client owns that process's lifecycle, and the GUI can't restart it.
 * This toast coexists with the saved/drift toast (distinct `dedupKey`).
 */
export interface SaveNotifyOptions {
  /**
   * When set, the saved change toggled this source's retrieval mode to or
   * from `hybrid` and a sticky "restart the knowledge MCP server" toast
   * should fire alongside the normal saved/drift toast. Omitted/undefined
   * means no hybrid change — no restart toast.
   */
  hybridRestart?: { sourceId: string };
}

export function useSaveSuccessNotification(
  agent: string,
  reinstall: (targets: Platform[]) => void,
): (savedTitle: string, options?: SaveNotifyOptions) => Promise<void> {
  const { notify } = useNotifications();
  return useCallback(
    async (savedTitle: string, options?: SaveNotifyOptions) => {
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
      // Hybrid retrieval was toggled (on OR off): the serve process reads the
      // index + loads the embedder once at spawn and the GUI can't restart it,
      // so advise the user to reconnect the knowledge MCP server. Sticky (the
      // modal closes on save, so it must not auto-dismiss) + its own dedupKey
      // so it coexists with the saved/drift toast and repeated saves replace
      // rather than stack.
      if (options?.hybridRestart) {
        const { sourceId } = options.hybridRestart;
        notify({
          kind: "info",
          title: "Restart needed for hybrid search",
          body: `Hybrid retrieval for '${sourceId}' takes effect after the knowledge MCP server restarts. Reconnect the '${agent}-knowledge' server in your AI client (e.g. Claude Code: /mcp → reconnect), or start a new session.`,
          durationMs: "sticky",
          dedupKey: `hybrid-restart:${agent}:${sourceId}`,
        });
      }
    },
    [agent, notify, reinstall],
  );
}
