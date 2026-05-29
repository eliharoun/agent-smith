import { create } from "zustand";
export type Mode = "guided" | "expert";

interface ModeState {
  mode: Mode;
  setMode: (m: Mode) => void;
}

export const useModeStore = create<ModeState>((set) => ({
  mode: "guided",
  setMode: (mode) => set({ mode }),
}));
