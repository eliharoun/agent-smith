import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { SmithError } from "../../core/smith-error";
import { bridgeAtlassianAuthToPerProductEnv } from "../../io/atlassian-bridge";
import { parseEnvFile, upsertEnvLines } from "../../io/dotenv-roundtrip";
import { canonicalUserPath } from "../../io/registry";
import { stateHome } from "../../io/state-home";
import { CANONICAL_USER_MD_TEMPLATE } from "../../io/user-template";

/**
 * Injectable surface for initUser. The default implementation uses
 * `node:child_process.spawn` and `Bun.file().exists()`; tests stub
 * all three so they can verify argv splitting, ENOENT translation,
 * and the self-bootstrap path without ever touching the real
 * filesystem or launching a real editor.
 */
export interface InitUserDeps {
  /** Returns true iff the user manifest exists on disk. */
  manifestExists: () => Promise<boolean>;
  /**
   * Spawn the editor. Resolves with the exit code, or rejects with an
   * Error whose `.code === "ENOENT"` if the binary is missing on PATH.
   * Argv is the full list including the binary as `argv[0]` and the
   * manifest path as the final positional arg.
   */
  spawnEditor: (argv: string[]) => Promise<number>;
  /**
   * Seed the canonical USER.md template at the given path. The default
   * implementation creates the parent directory recursively and writes
   * the same template `smith init` writes (see init.ts:69 — keep in
   * sync). Called from the missing-manifest self-bootstrap path so a
   * fresh installer user can run `smith init-user` without a prior
   * `smith init`. Optional in the DI surface for backwards compat;
   * the real `initUser()` factory always wires `defaultSeedManifest`.
   */
  seedManifest?: (path: string) => Promise<void>;
  /** Resolved path to the user manifest. Defaults to canonicalUserPath(). */
  userPath?: string;
  /**
   * Write bridged per-product env vars after editor closes. Optional
   * DI seam for testing. Default reads .env, checks for SMITH_ATLASSIAN
   * vars, and writes JIRA/CONFLUENCE per-product vars.
   */
  bridgeEnv?: () => Promise<void>;
}

function defaultSpawn(argv: string[]): Promise<number> {
  const [bin, ...rest] = argv;
  if (!bin) {
    return Promise.reject(new Error("empty argv"));
  }
  return new Promise<number>((resolve, reject) => {
    const child = spawn(bin, rest, { stdio: "inherit" });
    child.on("error", (err) => reject(err));
    child.on("exit", (code) =>
      code === 0 ? resolve(0) : reject(new Error(`Editor exited ${code}`)),
    );
  });
}

async function defaultSeedManifest(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, CANONICAL_USER_MD_TEMPLATE);
}

export async function initUserImpl(deps: InitUserDeps): Promise<number> {
  const userPath = deps.userPath ?? canonicalUserPath();

  // Self-bootstrap: if the manifest doesn't exist, create the parent
  // directory and seed the canonical "About me" template. This removes
  // the rc.2 hard-precondition that `smith init-user` required a
  // pre-existing `smith init` run. The template content matches
  // init.ts:69 verbatim so re-running `smith init` later is a no-op.
  //
  // Side-effect note: if the editor spawn below fails with ENOENT,
  // the seeded stub remains on disk. This is intentional — the user
  // can re-run `smith init-user` (or any other smith command) and
  // the stub will be picked up as their starting USER.md.
  if (!(await deps.manifestExists())) {
    const seed = deps.seedManifest ?? defaultSeedManifest;
    await seed(userPath);
  }

  // Split EDITOR on whitespace so values like "code --wait" or
  // "emacs -nw" round-trip correctly. The first token is the binary,
  // any remaining tokens are flags, and the user manifest path is
  // always the final positional arg.
  const editor = process.env.EDITOR ?? "vi";
  const tokens = editor
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0);
  if (tokens.length === 0) {
    tokens.push("vi");
  }
  const argv = [...tokens, userPath];
  const bin = tokens[0]!;

  try {
    await deps.spawnEditor(argv);
  } catch (err) {
    // ENOENT here means the EDITOR binary isn't on PATH. Wrap with a
    // SmithError naming the offending binary so the user knows which
    // env var to fix; preserve other errors (non-zero exit, etc) as-is.
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new SmithError({
        code: "usage-error",
        message: `could not launch editor '${bin}' (set the EDITOR env var to a valid binary)`,
        suggestedCommand: "EDITOR=$(command -v vim || command -v nano) smith init-user",
      });
    }
    throw err;
  }

  // After editor closes successfully, bridge SMITH_ATLASSIAN_* to
  // per-product JIRA_*/CONFLUENCE_* vars in the .env file.
  const bridge = deps.bridgeEnv ?? defaultBridgeEnv;
  await bridge();

  return 0;
}

async function defaultBridgeEnv(): Promise<void> {
  const envPath = join(stateHome(), ".env");
  // Check process.env first, then fall back to .env file contents.
  let email = process.env["SMITH_ATLASSIAN_EMAIL"];
  let token = process.env["SMITH_ATLASSIAN_API_TOKEN"];
  let baseUrl = process.env["SMITH_ATLASSIAN_BASE_URL"];

  let raw = "";
  if (!email || !token || !baseUrl) {
    try {
      raw = await readFile(envPath, "utf8");
    } catch {
      return;
    }
    const parsed = parseEnvFile(raw);
    email = email || parsed["SMITH_ATLASSIAN_EMAIL"];
    token = token || parsed["SMITH_ATLASSIAN_API_TOKEN"];
    baseUrl = baseUrl || parsed["SMITH_ATLASSIAN_BASE_URL"];
  }

  if (!email || !token || !baseUrl) return;

  const bridged = bridgeAtlassianAuthToPerProductEnv({ email, token, baseUrl });
  if (!raw) {
    try {
      raw = await readFile(envPath, "utf8");
    } catch {
      raw = "";
    }
  }
  const updated = upsertEnvLines(raw, bridged as unknown as Record<string, string | null>);
  await mkdir(dirname(envPath), { recursive: true });
  await Bun.write(envPath, updated);
}

export async function initUser(): Promise<number> {
  return initUserImpl({
    manifestExists: () => Bun.file(canonicalUserPath()).exists(),
    spawnEditor: defaultSpawn,
    seedManifest: defaultSeedManifest,
  });
}
