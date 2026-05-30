import { useQuery } from "@tanstack/react-query";
import type { RegistryKind } from "gui-shared";
import { catalogsApi } from "@/api/catalogs";

export const catalogsKey = ["catalogs"] as const;

export function useCatalogs(kind?: RegistryKind) {
  return useQuery({
    queryKey: kind ? [...catalogsKey, kind] : catalogsKey,
    queryFn: () => catalogsApi.list(kind),
  });
}
