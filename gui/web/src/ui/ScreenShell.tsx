import type { ReactNode } from "react";
import { useThemeStore } from "@/store/theme";
import { ScanlineBackground } from "./ScanlineBackground";

export function ScreenShell({ chrome, children }: { chrome?: ReactNode; children: ReactNode }) {
  const intensity = useThemeStore((s) => s.intensity);
  return (
    <div className="relative flex-1 p-6 overflow-y-auto">
      <ScanlineBackground intensity={intensity} />
      <div className="relative z-10 max-w-6xl mx-auto">
        {chrome}
        <div className="grid grid-cols-1 gap-4">{children}</div>
      </div>
    </div>
  );
}
