// Minimal stub — Task 5 implements real tree-sitter tag extraction + REPOMAP_VERSION.
export const REPOMAP_VERSION = 1;
export interface Tag {
  relPath: string;
  name: string;
  role: "def" | "ref";
  line: number;
  signature: string;
}
export async function extractTags(_relPath: string, _text: string): Promise<Tag[]> {
  return [];
}
