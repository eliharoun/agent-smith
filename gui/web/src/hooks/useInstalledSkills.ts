import { useQuery } from "@tanstack/react-query";
import { installedSkillsApi } from "@/api/installedSkills";

export const installedSkillsKey = ["installed-skills"] as const;

export function useInstalledSkills() {
  return useQuery({
    queryKey: installedSkillsKey,
    queryFn: installedSkillsApi.list,
  });
}
