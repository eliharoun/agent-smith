import { homedir } from "node:os";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { pathExists, resolveWorkspacePath } from "./workspace-version";

const PKG = "@eliharoun/agent-smith";

export type InstallKind = "source" | "packaged" | "unknown";
export type PackageManager = "npm" | "bun" | "pnpm" | "unknown";

export interface InstallInfo {
  /** source = .git present; packaged = workspace resolved but no .git; unknown = no workspace. */
  kind: InstallKind;
  /** Meaningful only when kind === "packaged". */
  packageManager: PackageManager;
  /** resolveWorkspacePath result; null ⇒ kind "unknown". */
  workspacePath: string | null;
  /** Ready-to-print upgrade command, or null when unknown. */
  updateCommand: string | null;
  /** True iff kind === "source" — i.e. the git update pipeline may run. */
  canGitUpdate: boolean;
}

export interface DetectDeps {
  /** import.meta.url of the running module. */
  importMetaUrl: string;
  /** Injectable existence probe (default: pathExists from workspace-version). */
  pathExists?: (p: string) => Promise<boolean>;
  /** Injectable workspace resolver (default: resolveWorkspacePath). */
  resolveWorkspace?: (sourceFilePath: string) => Promise<string | null>;
  /** Injectable env reader (default: process.env). */
  env?: NodeJS.ProcessEnv;
  /** Injectable HOME for path heuristics (default: os.homedir()). */
  homeDir?: string;
}

function detectPackageManager(ws: string, env: NodeJS.ProcessEnv, home: string): PackageManager {
  // Highest-confidence signal (present only at install time): the package
  // manager's user-agent. Same env family postinstall-preflight.cjs reads.
  const ua = (env.npm_config_user_agent ?? "").split("/")[0];
  if (ua === "bun" || ua === "pnpm" || ua === "npm") return ua;

  // Runtime signal: the install location. process.execPath is useless here —
  // smith always runs under bun regardless of which manager installed it.
  const p = ws.split(sep).join("/");
  const homeNorm = home.split(sep).join("/");
  // Global bun installs live under <home>/.bun/; also accept a bare /.bun/
  // segment for non-standard HOME layouts.
  if (p.startsWith(`${homeNorm}/.bun/`) || p.includes("/.bun/")) return "bun";
  if (p.includes("/.pnpm/")) return "pnpm";
  if (env.PNPM_HOME && p.startsWith(env.PNPM_HOME.split(sep).join("/"))) return "pnpm";
  if (p.includes("/node_modules/")) return "npm"; // best-effort fallback for a global node_modules tree
  return "unknown";
}

function updateCommandFor(pm: PackageManager): string {
  switch (pm) {
    case "npm":
      return `npm install -g ${PKG}`;
    case "bun":
      return `bun add -g ${PKG}`;
    case "pnpm":
      return `pnpm add -g ${PKG}`;
    default:
      return `reinstall ${PKG} globally with your package manager (npm/bun/pnpm)`;
  }
}

export async function getInstallInfo(deps: DetectDeps): Promise<InstallInfo> {
  const exists = deps.pathExists ?? pathExists;
  const resolve = deps.resolveWorkspace ?? resolveWorkspacePath;
  const ws = await resolve(fileURLToPath(deps.importMetaUrl));
  if (ws === null) {
    return {
      kind: "unknown",
      packageManager: "unknown",
      workspacePath: null,
      updateCommand: null,
      canGitUpdate: false,
    };
  }

  // Do NOT catch: EACCES / non-ENOENT must propagate (workspace-version.ts:171
  // contract). pathExists already swallows only ENOENT.
  if (await exists(join(ws, ".git"))) {
    return {
      kind: "source",
      packageManager: "unknown",
      workspacePath: ws,
      updateCommand: "smith update",
      canGitUpdate: true,
    };
  }

  const pm = detectPackageManager(ws, deps.env ?? process.env, deps.homeDir ?? homedir());
  return {
    kind: "packaged",
    packageManager: pm,
    workspacePath: ws,
    updateCommand: updateCommandFor(pm),
    canGitUpdate: false,
  };
}

/** Production entry point: detect the install type of the running module. */
export async function getInstallInfoForRunningModule(importMetaUrl: string): Promise<InstallInfo> {
  return getInstallInfo({ importMetaUrl });
}
