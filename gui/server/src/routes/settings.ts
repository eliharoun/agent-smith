import { GuiStatePatch } from "gui-shared";
import type { Hono } from "hono";
import { HttpError } from "../middleware/error";
import { loadGuiState, saveGuiState } from "../services/gui-state";

export interface SettingsDeps {
  guiStatePath: string;
  currentVersion: string;
}

export function registerSettingsRoute(app: Hono, deps: SettingsDeps) {
  app.get("/api/settings", async (c) => {
    const state = await loadGuiState({
      path: deps.guiStatePath,
      currentVersion: deps.currentVersion,
    });
    return c.json(state);
  });

  app.put("/api/settings", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = GuiStatePatch.safeParse(body);
    if (!parsed.success) {
      throw new HttpError(400, "BAD_REQUEST", parsed.error.message);
    }
    const next = await saveGuiState({
      path: deps.guiStatePath,
      currentVersion: deps.currentVersion,
      patch: parsed.data,
    });
    return c.json(next);
  });
}
