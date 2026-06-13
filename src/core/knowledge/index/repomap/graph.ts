export interface Tag {
  relPath: string;
  name: string;
  role: "def" | "ref";
  line: number;
  signature: string;
}
export interface RankedFile {
  relPath: string;
  score: number;
  defs: { name: string; signature: string; line: number }[];
}

export function rankFiles(tags: Tag[], opts: { focus?: string }): RankedFile[] {
  const defsBySymbol = new Map<string, Set<string>>();
  const defsByFile = new Map<string, { name: string; signature: string; line: number }[]>();
  for (const t of tags)
    if (t.role === "def") {
      const set = defsBySymbol.get(t.name) ?? defsBySymbol.set(t.name, new Set()).get(t.name);
      set?.add(t.relPath);
      const arr = defsByFile.get(t.relPath) ?? defsByFile.set(t.relPath, []).get(t.relPath);
      arr?.push({ name: t.name, signature: t.signature, line: t.line });
    }
  const files = new Set(tags.map((t) => t.relPath));
  const edges = new Map<string, Map<string, number>>();
  for (const t of tags)
    if (t.role === "ref") {
      for (const to of defsBySymbol.get(t.name) ?? []) {
        if (to === t.relPath) continue;
        const m = edges.get(t.relPath) ?? edges.set(t.relPath, new Map()).get(t.relPath);
        m?.set(to, (m.get(to) ?? 0) + 1);
      }
    }
  const N = files.size || 1;
  const damping = 0.85;
  let rank = new Map([...files].map((f) => [f, 1 / N]));
  for (let it = 0; it < 20; it++) {
    const next = new Map([...files].map((f) => [f, (1 - damping) / N]));
    for (const [from, tos] of edges) {
      const total = [...tos.values()].reduce((s, w) => s + w, 0) || 1;
      for (const [to, w] of tos)
        next.set(to, (next.get(to) ?? 0) + damping * (rank.get(from) ?? 0) * (w / total));
    }
    if (opts.focus) {
      const b = opts.focus.toLowerCase();
      for (const f of files) if (f.toLowerCase().includes(b)) next.set(f, (next.get(f) ?? 0) * 2);
    }
    rank = next;
  }
  return [...files]
    .map((relPath) => ({
      relPath,
      score: rank.get(relPath) ?? 0,
      defs: defsByFile.get(relPath) ?? [],
    }))
    .sort((a, b) => b.score - a.score);
}
