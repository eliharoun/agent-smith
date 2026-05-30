import { useEffect, useRef } from "react";

const GLYPHS = "01ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉ".split("");

export function MatrixRain({ className = "" }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let cols = 0;
    let drops: number[] = [];
    const resize = () => {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
      cols = Math.floor(canvas.width / 14);
      drops = new Array(cols).fill(0);
    };
    resize();
    window.addEventListener("resize", resize);
    const tick = () => {
      ctx.fillStyle = "rgba(0,0,0,0.08)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#00ff41";
      ctx.font = "12px JetBrains Mono, monospace";
      for (let i = 0; i < cols; i++) {
        const g = GLYPHS[Math.floor(Math.random() * GLYPHS.length)] ?? "0";
        ctx.fillText(g, i * 14, (drops[i] ?? 0) * 14);
        if ((drops[i] ?? 0) * 14 > canvas.height && Math.random() > 0.975) drops[i] = 0;
        else drops[i] = (drops[i] ?? 0) + 1;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);
  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      data-testid="matrix-rain"
      className={`block w-full h-full ${className}`}
    />
  );
}
