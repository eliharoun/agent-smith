const K1 = 1.5;
const B = 0.75;
const TOKEN_RE = /[A-Za-z0-9_]+/g;

function tokenize(s: string): string[] {
  return (s.toLowerCase().match(TOKEN_RE) ?? []).filter((t) => t.length >= 2);
}

interface DocStats {
  path: string;
  tokens: string[];
  length: number;
  raw: string;
}

export interface Bm25Hit {
  path: string;
  score: number;
  snippet: string;
}

export class Bm25Index {
  private docs: DocStats[] = [];
  private df = new Map<string, number>();
  private avgLen = 0;

  addDoc(path: string, content: string): void {
    const tokens = tokenize(content);
    this.docs.push({ path, tokens, length: tokens.length, raw: content });
    const seen = new Set<string>();
    for (const t of tokens) {
      if (!seen.has(t)) {
        seen.add(t);
        this.df.set(t, (this.df.get(t) ?? 0) + 1);
      }
    }
    this.avgLen = this.docs.reduce((n, d) => n + d.length, 0) / this.docs.length;
  }

  search(query: string, k = 5): Bm25Hit[] {
    const qTokens = tokenize(query);
    if (qTokens.length === 0) return [];
    const N = this.docs.length;
    const scores = this.docs.map((d) => {
      let score = 0;
      for (const t of qTokens) {
        const tf = d.tokens.filter((x) => x === t).length;
        if (tf === 0) continue;
        const df = this.df.get(t) ?? 0;
        const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
        const norm = (tf * (K1 + 1)) / (tf + K1 * (1 - B + B * (d.length / (this.avgLen || 1))));
        score += idf * norm;
      }
      return { d, score };
    });
    return scores
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, k)
      .map((s) => ({ path: s.d.path, score: s.score, snippet: snippetFor(s.d.raw, qTokens) }));
  }

  toJSON(): unknown {
    return { docs: this.docs.map((d) => ({ path: d.path, raw: d.raw })) };
  }

  static fromJSON(j: unknown): Bm25Index {
    const ix = new Bm25Index();
    const obj = j as { docs?: { path: string; raw: string }[] };
    for (const d of obj.docs ?? []) ix.addDoc(d.path, d.raw);
    return ix;
  }
}

function snippetFor(raw: string, qTokens: string[]): string {
  const lc = raw.toLowerCase();
  let bestIdx = -1;
  let bestT = "";
  for (const t of qTokens) {
    const i = lc.indexOf(t);
    if (i >= 0 && (bestIdx < 0 || i < bestIdx)) {
      bestIdx = i;
      bestT = t;
    }
  }
  if (bestIdx < 0) return raw.slice(0, 160);
  const start = Math.max(0, bestIdx - 40);
  const end = Math.min(raw.length, bestIdx + bestT.length + 80);
  return (start > 0 ? "…" : "") + raw.slice(start, end) + (end < raw.length ? "…" : "");
}
