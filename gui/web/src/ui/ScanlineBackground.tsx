export function ScanlineBackground({
  intensity = "medium",
}: {
  intensity?: "low" | "medium" | "high";
}) {
  if (intensity === "low") return null;
  const opacity = intensity === "high" ? 0.08 : 0.05;
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-0"
      style={{
        backgroundImage: `repeating-linear-gradient(0deg, rgba(0,255,65,${opacity}) 0px, rgba(0,255,65,${opacity}) 1px, transparent 1px, transparent 3px)`,
      }}
    />
  );
}
