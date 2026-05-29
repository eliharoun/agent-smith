import { useQuery } from "@tanstack/react-query";
import { skillCatalogsApi } from "@/api/skillCatalogs";

export const skillCatalogsKey = ["skill-catalogs"] as const;

export function useSkillCatalogs() {
  return useQuery({
    queryKey: skillCatalogsKey,
    queryFn: skillCatalogsApi.list,
  });
}
