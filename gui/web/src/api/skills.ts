import type { SkillDetail, SkillSummary } from "gui-shared";
import { apiFetch } from "./client";

export const skillsApi = {
  list: () => apiFetch<SkillSummary[]>("/api/skills"),
  get: (name: string) => apiFetch<SkillDetail>(`/api/skills/${encodeURIComponent(name)}`),
};
