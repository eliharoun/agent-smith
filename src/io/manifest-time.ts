/** Strip milliseconds from an ISO timestamp for byte-deterministic manifests. */
export function pinnedIso(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}
