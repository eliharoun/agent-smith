import { useMutation } from "@tanstack/react-query";
import type { GitVerifyRequest } from "gui-shared";
import { gitVerifyApi } from "@/api/gitVerify";

export function useGitVerify() {
  return useMutation({
    mutationFn: (payload: GitVerifyRequest) => gitVerifyApi.verify(payload),
  });
}
