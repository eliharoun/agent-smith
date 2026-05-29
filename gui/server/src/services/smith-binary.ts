/**
 * Resolves the smith executable to invoke from the GUI server.
 *
 * Honors SMITH_BIN for tests and packaged distributions; falls back to "smith"
 * on PATH, which works for both developer installs (`bun link`) and the
 * eventually-published binary.
 */
export function smithBinaryPath(): string {
  return process.env.SMITH_BIN ?? "smith";
}
