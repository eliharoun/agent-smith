import { describe, expect, it } from "bun:test";
import { LockManager } from "./lock-manager";

describe("LockManager", () => {
  it("acquires a lock when key is free", () => {
    const lm = new LockManager();
    expect(lm.tryAcquire("agent:foo", "job1")).toBe(true);
  });

  it("rejects acquisition when key is held", () => {
    const lm = new LockManager();
    lm.tryAcquire("agent:foo", "job1");
    expect(lm.tryAcquire("agent:foo", "job2")).toBe(false);
  });

  it("allows different keys in parallel", () => {
    const lm = new LockManager();
    lm.tryAcquire("agent:foo", "job1");
    expect(lm.tryAcquire("agent:bar", "job2")).toBe(true);
  });

  it("releases a lock by jobId", () => {
    const lm = new LockManager();
    lm.tryAcquire("agent:foo", "job1");
    lm.release("job1");
    expect(lm.tryAcquire("agent:foo", "job2")).toBe(true);
  });

  it("reports the holder of a contested key", () => {
    const lm = new LockManager();
    lm.tryAcquire("agent:foo", "job1");
    expect(lm.holderOf("agent:foo")).toBe("job1");
    expect(lm.holderOf("agent:bar")).toBeUndefined();
  });

  it("acquires multiple keys atomically (all-or-nothing)", () => {
    const lm = new LockManager();
    lm.tryAcquire("agent:foo", "job1");
    const ok = lm.tryAcquireMany(["agent:foo", "agent:bar"], "job2");
    expect(ok).toBe(false);
    expect(lm.holderOf("agent:bar")).toBeUndefined();
  });

  // ----- Phase 2 key shapes -----

  it("treats skill:<name> and agent:<name> as independent", () => {
    const lm = new LockManager();
    expect(lm.tryAcquireMany(["skill:example/test"], "j1")).toBe(true);
    expect(lm.tryAcquireMany(["agent:example/test"], "j2")).toBe(true);
  });

  it("blocks two jobs that both want catalog:<label>", () => {
    const lm = new LockManager();
    expect(lm.tryAcquireMany(["catalog:my-cat"], "j1")).toBe(true);
    expect(lm.tryAcquireMany(["catalog:my-cat"], "j2")).toBe(false);
  });

  it("knowledge.add is serialized per-agent against agent.reconfigure", () => {
    const lm = new LockManager();
    expect(lm.tryAcquireMany(["knowledge:x", "agent:x"], "j1")).toBe(true);
    // reconfigure tries to grab agent:x — should fail
    expect(lm.tryAcquireMany(["agent:x"], "j2")).toBe(false);
    lm.release("j1");
    expect(lm.tryAcquireMany(["agent:x"], "j3")).toBe(true);
  });

  it("global:skills serializes all skill writes", () => {
    const lm = new LockManager();
    expect(lm.tryAcquireMany(["skill:a", "global:skills"], "j1")).toBe(true);
    // global blocks — even though skill:b is free
    expect(lm.tryAcquireMany(["skill:b", "global:skills"], "j2")).toBe(false);
  });
});

describe("all-agents wildcard lock", () => {
  it("blocks per-agent locks once held", () => {
    const lm = new LockManager();
    expect(lm.tryAcquireMany(["all-agents"], "j1")).toBe(true);
    expect(lm.tryAcquireMany(["agent:foo"], "j2")).toBe(false);
    expect(lm.holderOf("agent:foo")).toBe("j1");
  });

  it("is blocked by an existing per-agent lock", () => {
    const lm = new LockManager();
    expect(lm.tryAcquireMany(["agent:foo"], "j1")).toBe(true);
    expect(lm.tryAcquireMany(["all-agents"], "j2")).toBe(false);
    expect(lm.holderOf("all-agents")).toBe("j1");
  });

  it("releases cleanly", () => {
    const lm = new LockManager();
    expect(lm.tryAcquireMany(["all-agents"], "j1")).toBe(true);
    lm.release("j1");
    expect(lm.tryAcquireMany(["agent:foo"], "j2")).toBe(true);
  });

  it("does not partially acquire when all-agents is rejected mid-batch", () => {
    const lm = new LockManager();
    expect(lm.tryAcquireMany(["agent:foo"], "j1")).toBe(true);
    // j2 wants both 'workspace' (free) and 'all-agents' (blocked by agent:foo).
    // The whole batch must fail and 'workspace' must remain free.
    expect(lm.tryAcquireMany(["workspace", "all-agents"], "j2")).toBe(false);
    expect(lm.holderOf("workspace")).toBeUndefined();
  });
});
