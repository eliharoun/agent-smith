import { describe, expect, it } from "bun:test";
import { SseBroker } from "./sse-broker";

describe("SseBroker", () => {
  it("delivers events to a subscriber", async () => {
    const broker = new SseBroker();
    const events: string[] = [];
    const unsub = broker.subscribe("job1", (ev) => events.push(ev.type));
    broker.publish("job1", { type: "stdout", chunk: "hello" });
    broker.publish("job1", { type: "exit", code: 0, durationMs: 1 });
    unsub();
    expect(events).toEqual(["stdout", "exit"]);
  });

  it("replays buffered events to late subscribers", () => {
    const broker = new SseBroker();
    broker.publish("job1", { type: "stdout", chunk: "early" });
    const events: string[] = [];
    broker.subscribe("job1", (ev) => {
      if (ev.type === "stdout") events.push(ev.chunk);
    });
    expect(events).toEqual(["early"]);
  });

  it("formats an event as an SSE data frame", () => {
    const frame = SseBroker.format({ type: "stdout", chunk: "hi" });
    expect(frame).toBe(`data: ${JSON.stringify({ type: "stdout", chunk: "hi" })}\n\n`);
  });

  it("evicts buffers above max size", () => {
    const broker = new SseBroker({ maxBuffer: 2 });
    broker.publish("job1", { type: "stdout", chunk: "a" });
    broker.publish("job1", { type: "stdout", chunk: "b" });
    broker.publish("job1", { type: "stdout", chunk: "c" });
    const chunks: string[] = [];
    broker.subscribe("job1", (ev) => {
      if (ev.type === "stdout") chunks.push(ev.chunk);
    });
    expect(chunks).toEqual(["b", "c"]);
  });

  it("close() drops buffered events for that job", () => {
    const broker = new SseBroker();
    broker.publish("job1", { type: "stdout", chunk: "before-close" });
    broker.close("job1");
    const events: string[] = [];
    broker.subscribe("job1", (ev) => {
      if (ev.type === "stdout") events.push(ev.chunk);
    });
    expect(events).toEqual([]);
  });

  it("isolates events across jobIds", () => {
    const broker = new SseBroker();
    const job1Events: string[] = [];
    const job2Events: string[] = [];
    broker.subscribe("job1", (ev) => {
      if (ev.type === "stdout") job1Events.push(ev.chunk);
    });
    broker.subscribe("job2", (ev) => {
      if (ev.type === "stdout") job2Events.push(ev.chunk);
    });
    broker.publish("job1", { type: "stdout", chunk: "for-job1" });
    broker.publish("job2", { type: "stdout", chunk: "for-job2" });
    expect(job1Events).toEqual(["for-job1"]);
    expect(job2Events).toEqual(["for-job2"]);
  });

  it("delivers an event to multiple subscribers of the same job", () => {
    const broker = new SseBroker();
    const a: string[] = [];
    const b: string[] = [];
    broker.subscribe("job1", (ev) => {
      if (ev.type === "stdout") a.push(ev.chunk);
    });
    broker.subscribe("job1", (ev) => {
      if (ev.type === "stdout") b.push(ev.chunk);
    });
    broker.publish("job1", { type: "stdout", chunk: "fanout" });
    expect(a).toEqual(["fanout"]);
    expect(b).toEqual(["fanout"]);
  });
});
