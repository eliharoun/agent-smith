import { useQuery } from "@tanstack/react-query";
import { skillsApi } from "@/api/skills";

export const skillsKey = ["skills"] as const;

export function useSkills() {
  return useQuery({ queryKey: skillsKey, queryFn: skillsApi.list });
}
