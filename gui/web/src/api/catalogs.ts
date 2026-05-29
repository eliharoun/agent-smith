import type { CatalogList, RegistryKind } from "gui-shared";
import { apiFetch } from "./client";

export const catalogsApi = {
  list: (kind?: RegistryKind) =>
    apiFetch<CatalogList>(
      kind ? `/api/catalogs?kind=${encodeURIComponent(kind)}` : "/api/catalogs",
    ),
};
