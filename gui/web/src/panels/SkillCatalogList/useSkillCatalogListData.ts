import { useCatalogs } from "@/hooks/useCatalogs";

/**
 * Loads only skill-kind catalogs from the unified `/api/catalogs?kind=skill`
 * endpoint built in Task 15. The endpoint already returns CatalogEntry rows
 * with the lightweight health block (skillCount), so this hook is a thin
 * adapter.
 */
export function useSkillCatalogListData() {
  const q = useCatalogs("skill");
  return { catalogs: q.data ?? [], loading: q.isLoading, error: q.error };
}
