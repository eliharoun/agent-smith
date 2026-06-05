import type { Platform } from "gui-shared";
import { useMemo } from "react";
import { useDriftCheck } from "@/hooks/useDriftCheck";
import { useInstallState } from "@/hooks/useInstallState";
import { useReinstall } from "@/hooks/useReinstall";
import { Button } from "@/ui/Button";
import { Tooltip } from "@/ui/Tooltip";

/**
 * Header-mounted Re-install button. State machine:
 *
 *   - No platforms installed (or load not finished) → render nothing.
 *   - Installed but no drift → "Re-install" + subtle subtitle listing platforms.
 *   - Drifted → green dot + tooltip naming the drifted platforms; clicking
 *     dispatches an install scoped to the drifted platforms only.
 *   - In-flight → button is disabled with a "Re-installing…" label.
 *
 * The success/error notification lifecycle is handled inside `useReinstall`.
 */
export function ReinstallButton({ agent }: { agent: string }) {
  const installState = useInstallState(agent);
  const driftCheck = useDriftCheck(agent);
  const { reinstall, isPending } = useReinstall(agent);

  // Only main entries count. Sidecar manifests (Codex's `agents/openai.yaml`)
  // aren't actionable independently from the GUI today.
  const installedPlatforms = useMemo<Platform[]>(() => {
    const entries = installState.entries ?? [];
    return entries
      .filter((e) => e.kind === "main")
      .map((e) => e.platform)
      .sort();
  }, [installState.entries]);

  const drifted = useMemo<Platform[]>(() => {
    return [...(driftCheck.drifted ?? [])].sort();
  }, [driftCheck.drifted]);

  // Hide entirely when nothing is installed (per spec). Also hide while the
  // initial install-state load is in flight so the button doesn't briefly
  // render in a wrong state — `entries === undefined` until the first response.
  if (installState.entries === undefined) return null;
  if (installedPlatforms.length === 0) return null;

  const targetsToInstall: Platform[] = drifted.length > 0 ? drifted : installedPlatforms;
  const subtitle = `(${installedPlatforms.join(", ")})`;
  const driftLabel =
    drifted.length === 1
      ? `${drifted[0]} is out of date — re-install needed`
      : `${drifted.join(", ")} are out of date — re-install needed`;

  const button = (
    <Button
      onClick={() => reinstall(targetsToInstall)}
      disabled={isPending}
      aria-label="Re-install"
    >
      {isPending ? (
        <span className="inline-flex items-center gap-1">
          <span aria-hidden="true" className="inline-block animate-spin">
            ⟳
          </span>
          Re-installing…
        </span>
      ) : (
        "Re-install"
      )}
    </Button>
  );

  return (
    <span className="inline-flex items-center gap-2">
      {button}
      {drifted.length > 0 && (
        <Tooltip content={driftLabel}>
          <span
            data-testid="reinstall-drift-dot"
            aria-label={driftLabel}
            tabIndex={0}
            className="inline-block w-2 h-2 rounded-full bg-matrix-green shadow-[0_0_6px_rgba(26,255,140,0.7)] cursor-help"
          />
        </Tooltip>
      )}
      {drifted.length === 0 && (
        <span className="font-mono text-[10px] text-matrix-green-muted lowercase tracking-wider">
          {subtitle}
        </span>
      )}
    </span>
  );
}
