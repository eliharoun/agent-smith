/**
 * Per-agent knowledge-refresh manifest at
 * `<agentSmithHome>/refresh/<agent>/refresh-manifest.json`.
 *
 * The path lives at the sibling `refresh/` root — NOT under `agents/` —
 * so the manifest writer never creates a phantom bundle directory under
 * the user-global agents catalog. This matters when the bundle's source
 * is the synthetic "agent-smith-self" source (whose `agents/` lives in
 * the running CLI's repo, not under `<stateHome>/agents/`); writing to
 * `<stateHome>/agents/<name>/` would manifest as an empty bundle dir
 * the doctor sniff later flagged as "leftover from aborted init."
 *
 * Records which platforms have refresh hooks installed and which knowledge
 * sources the user opted in for. Written by `smith agent knowledge install`
 * after user consents; read by the uninstaller (to undo hook installation),
 * the doctor command (to detect drift), and `smith agent knowledge reconfigure`.
 */
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { assertWithin } from "../../io/assert-within";
import { PLATFORM_IDS, type PlatformId } from "../../io/platform-detect";
import { SmithError } from "../smith-error";
import { toMessage } from "../to-message";

// Re-use the canonical tuple from io/platform-detect so the accepted set
// never drifts from PlatformId. The runtime schema and the static type
// share one source of truth.
const PlatformIdSchema = z.enum(PLATFORM_IDS);
export type { PlatformId };

const RefreshConsentSchema = z.object({
  granted_at: z.string().datetime(),
  platforms: z.array(PlatformIdSchema),
  sources: z.array(z.string().min(1)),
});

export const RefreshManifestSchema = z.preprocess((input) => {
  // B11.5 migration: legacy manifests (pre-v0.24.0) had no schemaVersion
  // field. Inject schemaVersion: 1 in-memory when missing so v0.24.0
  // reads a current-shape object. Migration is lazy — the next write
  // (via reconfigure / install / uninstall) persists the new shape.
  if (
    input &&
    typeof input === "object" &&
    !("schemaVersion" in (input as Record<string, unknown>))
  ) {
    return { schemaVersion: 1, ...(input as Record<string, unknown>) };
  }
  return input;
}, z.object({
  schemaVersion: z.literal(1),
  agent: z.string().min(1),
  refresh_consent: RefreshConsentSchema,
}));

export type RefreshConsent = z.infer<typeof RefreshConsentSchema>;
export type RefreshManifest = z.infer<typeof RefreshManifestSchema>;

const MANIFEST_FILENAME = "refresh-manifest.json";
const REFRESH_DIR = "refresh";

/**
 * Canonical absolute path to the per-agent refresh manifest, sibling of
 * `<agentSmithHome>/agents/`. Exported so callers (uninstaller, doctor,
 * reconfigure, GUI server) reuse the same path policy and so tests can
 * assert the layout directly.
 */
export function refreshManifestPath(agentSmithHome: string, agent: string): string {
  return join(agentSmithHome, REFRESH_DIR, agent, MANIFEST_FILENAME);
}

function manifestPath(agentSmithHome: string, agent: string): string {
  return refreshManifestPath(agentSmithHome, agent);
}

/**
 * Read the refresh manifest for `agent`. Returns `undefined` when the file
 * does not exist. Throws a `SmithError` with code `"validation-failed"` when
 * the file exists but cannot be parsed or fails schema validation.
 */
export async function readRefreshManifest(
  agentSmithHome: string,
  agent: string,
): Promise<RefreshManifest | undefined> {
  const path = manifestPath(agentSmithHome, agent);
  // Defense-in-depth [v1-task B6]: agent name is normally validated at
  // the CLI boundary, but this function is reached from multiple call
  // paths and has no internal sanitization. Belt-and-suspenders before
  // any IO. Only assert when the home dir exists — readFile below will
  // surface ENOENT as undefined naturally.
  try {
    await stat(agentSmithHome);
    await assertWithin(path, agentSmithHome);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new SmithError(
      {
        code: "validation-failed",
        what: "refresh-manifest.json",
        reasons: [`${path}: failed to parse as JSON: ${toMessage(err)}`],
      },
      { cause: err },
    );
  }
  const result = RefreshManifestSchema.safeParse(parsed);
  if (!result.success) {
    throw new SmithError({
      code: "validation-failed",
      what: "refresh-manifest.json",
      reasons: result.error.issues.map(
        (i) => `${path}: ${i.path.join(".") || "(root)"}: ${i.message}`,
      ),
    });
  }
  return result.data;
}

/**
 * Write the refresh manifest for `agent`, creating the parent directory if
 * needed. Overwrites any existing manifest.
 */
export async function writeRefreshManifest(
  agentSmithHome: string,
  agent: string,
  manifest: RefreshManifest,
): Promise<void> {
  const path = manifestPath(agentSmithHome, agent);
  // Defense-in-depth [v1-task B6]. writeRefreshManifest is a write
  // operation; the dirname(path) mkdir below creates intermediate dirs
  // including agentSmithHome, so it's safe to assert before mkdir.
  await mkdir(agentSmithHome, { recursive: true });
  await assertWithin(path, agentSmithHome);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

/**
 * Remove the refresh manifest for `agent`. Idempotent: succeeds when the
 * file is already absent.
 */
export async function removeRefreshManifest(
  agentSmithHome: string,
  agent: string,
): Promise<void> {
  const path = manifestPath(agentSmithHome, agent);
  // Defense-in-depth [v1-task B6]. Only assert when the home dir exists —
  // rm with force:true tolerates a missing path naturally.
  try {
    await stat(agentSmithHome);
    await assertWithin(path, agentSmithHome);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw err;
  }
  await rm(path, { force: true });
}
