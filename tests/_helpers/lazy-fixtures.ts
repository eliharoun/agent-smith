import type { KnowledgeBlock, KnowledgeSource } from "../../src/core/knowledge/types";

export function lazyUrlSource(overrides: Partial<KnowledgeSource> = {}): KnowledgeSource {
  return {
    id: "wiki",
    type: "url",
    url: "https://wiki.internal.example.com/architecture",
    lazy: true,
    description:
      "Platform service architecture wiki. Use when answering deployment topology or service-boundary questions.",
    ...overrides,
  } as KnowledgeSource;
}

export function eagerUrlSource(overrides: Partial<KnowledgeSource> = {}): KnowledgeSource {
  return {
    id: "doc",
    type: "url",
    url: "https://example.com/doc",
    delivery: "auto",
    ...overrides,
  } as KnowledgeSource;
}

export function blockWith(...sources: KnowledgeSource[]): KnowledgeBlock {
  return { sources };
}
