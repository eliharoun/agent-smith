import type { RemoteBlock } from "gui-shared";
import { Chip } from "@/ui/Chip";

interface Props {
  remote: RemoteBlock | undefined;
  onClick: () => void;
}

/**
 * RemoteBadge (C4.7.1)
 *
 * Surfaces drift state on agent/skill list rows.
 *
 * Tri-state rendering:
 *   - no remote block       → render nothing (purely local entity)
 *   - lastRemoteSha unset
 *     or equal to pulled    → "synced" chip (neutral)
 *   - shas differ           → clickable "update available" chip (amber)
 *
 * Click only fires for the "behind" state — synced badges are inert
 * indicators with no action.
 */
export function RemoteBadge({ remote, onClick }: Props) {
  if (!remote) return null;
  const behind =
    remote.lastRemoteSha !== undefined && remote.lastRemoteSha !== remote.lastPulledSha;
  if (!behind) {
    return <Chip tone="neutral">↻ synced</Chip>;
  }
  return (
    <button type="button" onClick={onClick} className="cursor-pointer p-0 bg-transparent border-0">
      <Chip tone="amber">↑ update available</Chip>
    </button>
  );
}
