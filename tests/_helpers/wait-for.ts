// tests/_helpers/wait-for.ts
export async function waitFor(
  predicate: () => boolean,
  options: { timeoutMs?: number; tickMs?: number; description?: string } = {},
): Promise<void> {
  const { timeoutMs = 2000, tickMs = 10, description = "predicate" } = options;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, tickMs));
  }
  if (predicate()) return;
  throw new Error(`waitFor timeout after ${timeoutMs}ms: ${description}`);
}
