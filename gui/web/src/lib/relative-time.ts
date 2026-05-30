/**
 * Compact relative time formatter used in knowledge / refresh views.
 * Returns strings like `2d`, `5h`, `1m`, `now`, or `never` for null/undefined.
 *
 * Note: "month" and "year" units use rough averages (30d / 365d). Refresh
 * cadence rarely needs sub-day precision past a week, so this is fine for
 * display; for absolute accuracy we render `new Date(iso).toLocaleString()`
 * in tooltips.
 */
export function relativeTime(iso: string | undefined | null, now: number = Date.now()): string {
  if (!iso) return "never";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "never";
  const delta = Math.max(0, Math.floor((now - t) / 1000));
  if (delta < 60) return "now";
  if (delta < 3600) return `${Math.floor(delta / 60)}m`;
  if (delta < 86400) return `${Math.floor(delta / 3600)}h`;
  if (delta < 30 * 86400) return `${Math.floor(delta / 86400)}d`;
  if (delta < 365 * 86400) return `${Math.floor(delta / (30 * 86400))}mo`;
  return `${Math.floor(delta / (365 * 86400))}y`;
}
