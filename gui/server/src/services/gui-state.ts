import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
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

async function persist(path: string, state: unknown) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}
