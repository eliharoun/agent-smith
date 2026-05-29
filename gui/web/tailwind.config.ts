import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        "matrix-black": "#000000",
        "matrix-green": "#00ff41",
        "matrix-green-2": "#6fd96f",
        "matrix-green-muted": "#4a9d4a",
        "matrix-body": "#d4ffd4",
        "matrix-line": "#143614",
        "matrix-amber": "#ffb000",
        "matrix-red": "#ff3838",
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      boxShadow: {
        "matrix-glow": "0 0 12px rgba(0,255,65,0.35), 0 0 2px rgba(0,255,65,0.65)",
        "matrix-focus": "0 0 0 1px #00ff41, 0 0 12px rgba(0,255,65,0.55)",
      },
      keyframes: {
        scanline: {
          "0%": { backgroundPositionY: "0" },
          "100%": { backgroundPositionY: "100vh" },
        },
        cursorBlink: {
          "0%, 49%": { opacity: "1" },
          "50%, 100%": { opacity: "0" },
        },
      },
      animation: {
        scanline: "scanline 8s linear infinite",
        "cursor-blink": "cursorBlink 1s steps(1) infinite",
      },
    },
  },
  plugins: [],
} satisfies Config;
