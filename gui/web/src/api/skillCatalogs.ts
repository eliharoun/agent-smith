import type { SkillCatalog } from "gui-shared";
import { apiFetch } from "./client";

export const skillCatalogsApi = {
  list: () => apiFetch<SkillCatalog[]>("/api/skill-catalogs"),
};
