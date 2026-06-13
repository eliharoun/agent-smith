// src/core/knowledge/index/index-paths.ts
import { join } from "node:path";
/** The hybrid index DB lives under .cache/ so swapStageIntoLive preserves it. */
export function indexDbPath(knowledgeDir: string): string {
  return join(knowledgeDir, ".cache", "index", "knowledge.db");
}
