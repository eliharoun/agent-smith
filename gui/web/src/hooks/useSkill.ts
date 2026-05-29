import { useQuery } from "@tanstack/react-query";
import { skillsApi } from "@/api/skills";
import { skillsKey } from "./useSkills";

export function useSkill(name: string) {
  return useQuery({
    queryKey: [...skillsKey, name],
    queryFn: () => skillsApi.get(name),
    enabled: name.length > 0,
  });
}
