import { useEffect } from "react";
import { usePatchSettings, useSettings } from "@/hooks/useSettings";
import { useThemeStore } from "@/store/theme";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";

type Intensity = "low" | "medium" | "high";

export function ThemeIntensity() {
  const intensity = useThemeStore((s) => s.intensity);
  const setIntensity = useThemeStore((s) => s.setIntensity);
  const settings = useSettings();
  const patch = usePatchSettings();

  useEffect(() => {
    if (settings.data) setIntensity(settings.data.theme.intensity);
  }, [settings.data, setIntensity]);

  return (
    <Card>
      <div className="font-mono text-[10px] uppercase tracking-widest text-matrix-green-muted mb-3">
        // theme intensity
      </div>
      <div className="flex gap-2">
        {(["low", "medium", "high"] as Intensity[]).map((i) => (
          <Button
            key={i}
            variant={intensity === i ? "primary" : "ghost"}
            onClick={() => {
              setIntensity(i);
              patch.mutate({ theme: { intensity: i } });
            }}
          >
            {i}
          </Button>
        ))}
      </div>
    </Card>
  );
}
