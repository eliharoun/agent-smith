import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { userMdApi } from "@/api/user-md";

export function useUserMd() {
  return useQuery({ queryKey: ["user-md"], queryFn: userMdApi.get });
}

export function useSaveUserMd() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (content: string) => userMdApi.put(content),
    onSuccess: (_, content) => {
      qc.setQueryData(["user-md"], { content });
      qc.invalidateQueries({ queryKey: ["onboarding"] });
    },
  });
}
