import { describe, expect, it } from "vitest";
import { reducer, type State } from "./useJackOutMachine";

const initial: State = {
  stage: "warning",
  jobId: null,
  sawStdout: false,
  errorMessage: null,
};

describe("jackOut reducer", () => {
  it("warning → confirming → warning", () => {
    let s = reducer(initial, { type: "confirm" });
    expect(s.stage).toBe("confirming");
    s = reducer(s, { type: "cancel" });
    expect(s.stage).toBe("warning");
  });

  it("confirming → running on spawned", () => {
    const s = reducer({ ...initial, stage: "confirming" }, { type: "spawned", jobId: "j" });
    expect(s.stage).toBe("running");
    expect(s.jobId).toBe("j");
  });

  it("running + disconnect WITHOUT stdout stays running", () => {
    const s = reducer({ ...initial, stage: "running" }, { type: "disconnect" });
    expect(s.stage).toBe("running");
  });

  it("running + stdout + disconnect → succeeded", () => {
    let s = reducer({ ...initial, stage: "running" }, { type: "stdout" });
    s = reducer(s, { type: "disconnect" });
    expect(s.stage).toBe("succeeded");
  });

  it("running + exit code 0 → succeeded", () => {
    const s = reducer({ ...initial, stage: "running" }, { type: "exit", code: 0 });
    expect(s.stage).toBe("succeeded");
  });

  it("running + exit code 1 → failed with message", () => {
    const s = reducer({ ...initial, stage: "running" }, { type: "exit", code: 1 });
    expect(s.stage).toBe("failed");
    expect(s.errorMessage).toMatch(/exit code 1/);
  });

  it("fail action sets message regardless of stage", () => {
    const s = reducer(initial, { type: "fail", message: "boom" });
    expect(s.stage).toBe("failed");
    expect(s.errorMessage).toBe("boom");
  });

  it("ignores invalid transitions", () => {
    const s = reducer({ ...initial, stage: "running" }, { type: "confirm" });
    expect(s.stage).toBe("running");
  });
});
