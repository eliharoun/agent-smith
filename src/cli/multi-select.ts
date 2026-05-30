export interface MultiSelectItem {
  label: string;
  hint?: string;
  annotation?: string;
}
export interface MultiSelectOpts {
  read: () => Promise<string>;
  print?: (s: string) => void;
  defaultAll?: boolean;
}

/**
 * Line-based numbered multi-select. Returns the selected zero-based indices.
 * Matches the codebase's hand-rolled prompt style (see readConsentChoice).
 */
export async function promptMultiSelect(
  items: MultiSelectItem[],
  opts: MultiSelectOpts,
): Promise<number[]> {
  const print = opts.print ?? ((s: string) => process.stderr.write(`${s}\n`));
  const notInstalled = items.map((_, i) => i).filter((i) => items[i]?.annotation !== "[installed]");

  for (let n = 0; n < items.length; n++) {
    const it = items[n]!;
    const ann = it.annotation ? ` ${it.annotation}` : "";
    const hint = it.hint ? `  ${it.hint}` : "";
    print(`  ${n + 1}  ${it.label}${hint}${ann}`);
  }
  print("Select [1-N, comma-sep, 'all', '*all', 'none']:");

  while (true) {
    const raw = (await opts.read()).trim().toLowerCase();
    if (raw === "") {
      if (opts.defaultAll) return notInstalled;
      continue;
    }
    if (raw === "none" || raw === "q") return [];
    if (raw === "all") return notInstalled;
    if (raw === "*all" || raw === "all*") return items.map((_, i) => i);
    const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
    const idx: number[] = [];
    let bad = false;
    for (const p of parts) {
      const n = Number(p);
      if (!Number.isInteger(n) || n < 1 || n > items.length) { bad = true; break; }
      if (!idx.includes(n - 1)) idx.push(n - 1);
    }
    if (bad || idx.length === 0) {
      print(`not in list: ${raw} — pick 1-${items.length}, 'all', or 'none'`);
      continue;
    }
    return idx;
  }
}
