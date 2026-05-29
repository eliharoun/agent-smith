import { act } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useActiveJobsStore } from "./active-jobs";
import { useModeStore } from "./mode";
import { useThemeStore } from "./theme";

describe("zustand stores", () => {
  it("mode toggles", () => {
    act(() => useModeStore.getState().setMode("expert"));
    expect(useModeStore.getState().mode).toBe("expert");
    act(() => useModeStore.getState().setMode("guided"));
  });

  it("active jobs push/drop and dedupe", () => {
    const { push, drop } = useActiveJobsStore.getState();
    act(() => {
      push("a", "agent.install");
      push("b", "agent.install");
      push("a", "agent.install");
    });
    expect(useActiveJobsStore.getState().active.slice(0, 2)).toEqual(["a", "b"]);
    act(() => drop("a"));
    expect(useActiveJobsStore.getState().active).not.toContain("a");
  });

  it("theme intensity persists in memory", () => {
    act(() => useThemeStore.getState().setIntensity("low"));
    expect(useThemeStore.getState().intensity).toBe("low");
    act(() => useThemeStore.getState().setIntensity("medium"));
  });
});
