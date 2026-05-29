import type { InstalledSkill } from "gui-shared";
import { apiFetch } from "./client";

export const installedSkillsApi = {
  list: () => apiFetch<InstalledSkill[]>("/api/installed-skills"),
};
