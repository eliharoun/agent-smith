export function Sparkline({
  values,
  width = 80,
  height = 20,
}: {
  values: number[];
  width?: number;
  height?: number;
}) {
  if (values.length === 0) return null;
  const max = Math.max(...values, 1);
  const step = width / Math.max(values.length - 1, 1);
  const points = values.map((v, i) => `${i * step},${height - (v / max) * height}`).join(" ");
  return (
    <svg width={width} height={height}>
      <polyline points={points} fill="none" stroke="#00ff41" strokeWidth="1" />
    </svg>
  );
}
