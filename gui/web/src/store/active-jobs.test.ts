import { act } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useActiveJobsStore } from "./active-jobs";

describe("active-jobs store", () => {
  beforeEach(() => {
    useActiveJobsStore.setState({ active: [], commands: {}, exits: {} });
  });

  it("push records the command associated with a job id", () => {
    act(() => {
      useActiveJobsStore.getState().push("job-1", "agent.install");
    });
    expect(useActiveJobsStore.getState().active).toEqual(["job-1"]);
    expect(useActiveJobsStore.getState().commands["job-1"]).toBe("agent.install");
  });

  it("getCommand returns the command for a known job id, undefined otherwise", () => {
    act(() => {
      useActiveJobsStore.getState().push("job-2", "agent.destroy");
    });
    const { getCommand } = useActiveJobsStore.getState();
    expect(getCommand("job-2")).toBe("agent.destroy");
    expect(getCommand("missing")).toBeUndefined();
  });

  it("drop removes the id from active and the command mapping", () => {
    act(() => {
      useActiveJobsStore.getState().push("job-3", "agent.install");
      useActiveJobsStore.getState().drop("job-3");
    });
    expect(useActiveJobsStore.getState().active).not.toContain("job-3");
    expect(useActiveJobsStore.getState().commands["job-3"]).toBeUndefined();
  });

  it("re-pushing the same id updates its command and dedupes ordering", () => {
    act(() => {
      useActiveJobsStore.getState().push("job-4", "agent.install");
      useActiveJobsStore.getState().push("job-5", "agent.destroy");
      useActiveJobsStore.getState().push("job-4", "agent.uninstall");
    });
    const state = useActiveJobsStore.getState();
    expect(state.active.slice(0, 2)).toEqual(["job-4", "job-5"]);
    expect(state.commands["job-4"]).toBe("agent.uninstall");
  });

  it("markExit records exit info without removing the job from active", () => {
    act(() => {
      useActiveJobsStore.getState().push("job-x", "agent.install");
      useActiveJobsStore.getState().markExit("job-x", { code: 0, durationMs: 123 });
    });
    const s = useActiveJobsStore.getState();
    expect(s.active).toContain("job-x");
    expect(s.exits["job-x"]).toEqual({ code: 0, durationMs: 123 });
  });

  it("drop also clears exit metadata", () => {
    act(() => {
      useActiveJobsStore.getState().push("job-y", "agent.destroy");
      useActiveJobsStore.getState().markExit("job-y", { code: 1 });
      useActiveJobsStore.getState().drop("job-y");
    });
    const s = useActiveJobsStore.getState();
    expect(s.active).not.toContain("job-y");
    expect(s.commands["job-y"]).toBeUndefined();
    expect(s.exits["job-y"]).toBeUndefined();
  });

  it("re-pushing a job id clears any prior exit info", () => {
    act(() => {
      useActiveJobsStore.getState().push("job-z", "agent.install");
      useActiveJobsStore.getState().markExit("job-z", { code: 1 });
      useActiveJobsStore.getState().push("job-z", "agent.install");
    });
    expect(useActiveJobsStore.getState().exits["job-z"]).toBeUndefined();
  });
});
