import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { GuiState, type GuiStatePatch } from "gui-shared";

export interface LoadOptions {
  path: string;
  currentVersion: string;
}

export interface SaveOptions extends LoadOptions {
  patch: GuiStatePatch;
}

function defaults(currentVersion: string) {
  return {
    schemaVersion: 1 as const,
    tourCompleted: false,
    lastSeenVersion: currentVersion,
    mode: "guided" as const,
    theme: { intensity: "medium" as const },
    port: 7777,
    exportDir: "",
  };
}

export async function loadGuiState(opts: LoadOptions) {
  try {
    const raw = await readFile(opts.path, "utf8");
    const parsed = GuiState.safeParse(JSON.parse(raw));
    if (parsed.success) return parsed.data;
    console.warn(`[gui-state] schema mismatch in ${opts.path}; resetting to defaults`);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`[gui-state] could not read ${opts.path}: ${String(err)}`);
    }
  }
  const fresh = defaults(opts.currentVersion);
  await persist(opts.path, fresh);
  return fresh;
}

export async function saveGuiState(opts: SaveOptions) {
  const current = await loadGuiState({
    path: opts.path,
    currentVersion: opts.currentVersion,
  });
  const next = {
    ...current,
    ...opts.patch,
    schemaVersion: 1 as const,
    theme: { ...current.theme, ...(opts.patch.theme ?? {}) },
  };
  await persist(opts.path, next);
  return next;
}

/** Resolve the user-configured exportDir, falling back to ~/Downloads.
 *  Always returns an absolute path. */
export function resolveExportDir(state: { exportDir?: string }): string {
  const configured = state.exportDir?.trim();
  if (configured && configured.length > 0) return configured;
  return join(homedir(), "Downloads");
}

async function persist(path: string, state: unknown) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}
