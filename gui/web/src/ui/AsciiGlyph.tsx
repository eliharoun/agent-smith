const G: Record<string, string> = {
  dashboard: "▣",
  agents: "◆",
  skills: "◈",
  catalogs: "⌘",
  catalog: "⌘",
  sources: "≡",
  refresh: "↻",
  atlassian: "⚑",
  doctor: "✚",
  settings: "⚙",
  daemon: "⊡",
  update: "⊞",
  history: "≣",
  jackout: "⏻",
  "jack-out": "⏻",
};
export function AsciiGlyph({
  name,
  className = "",
}: {
  name: keyof typeof G | string;
  className?: string;
}) {
  return (
    <span aria-hidden className={`font-mono ${className}`}>
      {G[name] ?? "·"}
    </span>
  );
}
