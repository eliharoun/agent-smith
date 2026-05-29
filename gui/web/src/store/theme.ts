import { create } from "zustand";

export type Intensity = "low" | "medium" | "high";

interface ThemeState {
  intensity: Intensity;
  setIntensity: (i: Intensity) => void;
}

export const useThemeStore = create<ThemeState>((set) => ({
  intensity: "medium",
  setIntensity: (intensity) => set({ intensity }),
}));
