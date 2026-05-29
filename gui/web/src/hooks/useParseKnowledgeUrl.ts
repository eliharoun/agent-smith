import { useMutation } from "@tanstack/react-query";
import { knowledgeApi } from "@/api/knowledge";

export function useParseKnowledgeUrl() {
  return useMutation({ mutationFn: (url: string) => knowledgeApi.parseUrl(url) });
}
