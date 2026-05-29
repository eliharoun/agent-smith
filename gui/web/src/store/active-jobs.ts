import { create } from "zustand";

export interface JobExitInfo {
  code: number;
  durationMs?: number;
}

interface ActiveJobsState {
  active: string[]; // jobIds, most recent first
  commands: Record<string, string>; // jobId -> originating command (e.g. "agent.install")
  exits: Record<string, JobExitInfo>; // jobId -> exit info (absent = still running or never exited under this push)
  push: (id: string, command: string) => void;
  markExit: (id: string, exit: JobExitInfo) => void;
  drop: (id: string) => void;
  getCommand: (id: string) => string | undefined;
}

export const useActiveJobsStore = create<ActiveJobsState>((set, get) => ({
  active: [],
  commands: {},
  exits: {},
  push: (id, command) =>
    set((s) => {
      const { [id]: _droppedExit, ...remainingExits } = s.exits;
      return {
        active: [id, ...s.active.filter((x) => x !== id)].slice(0, 20),
        commands: { ...s.commands, [id]: command },
        exits: remainingExits, // re-pushing under same id clears prior exit info
      };
    }),
  markExit: (id, exit) =>
    set((s) => ({
      exits: { ...s.exits, [id]: exit },
    })),
  drop: (id) =>
    set((s) => {
      const { [id]: _droppedCmd, ...remainingCommands } = s.commands;
      const { [id]: _droppedExit, ...remainingExits } = s.exits;
      return {
        active: s.active.filter((x) => x !== id),
        commands: remainingCommands,
        exits: remainingExits,
      };
    }),
  getCommand: (id) => get().commands[id],
}));
