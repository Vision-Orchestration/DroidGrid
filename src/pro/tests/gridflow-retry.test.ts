import { describe, it, expect, vi } from "vitest";
import { createForwarder } from "@gridflow-bridge/forwarder.js";

describe("createForwarder", () => {
  it("enqueues events and calls flush", async () => {
    const sendEvents = vi.fn().mockResolvedValue(true);
    const f = createForwarder(sendEvents, { maxQueue: 10, batchSize: 5 });
    f.enqueue({ gesture: "heel_tap" });
    expect(f.queue).toHaveLength(1);
    await f.flush();
    expect(sendEvents).toHaveBeenCalledTimes(1);
    expect(f.queue).toHaveLength(0);
  });

  it("retries on failure up to retries count", async () => {
    const sendEvents = vi.fn().mockResolvedValue(false);
    const f = createForwarder(sendEvents, {
      maxQueue: 10,
      batchSize: 5,
      retries: 2,
      baseDelayMs: 1,
    });
    f.enqueue({ gesture: "foot_lift" });
    await f.flush();
    // 1 initial + 2 retries = 3 attempts
    expect(sendEvents).toHaveBeenCalledTimes(3);
    expect(f.droppedEvents).toBe(1);
  });

  it("succeeds after retry", async () => {
    const sendEvents = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const f = createForwarder(sendEvents, {
      maxQueue: 10,
      batchSize: 5,
      retries: 2,
      baseDelayMs: 1,
    });
    f.enqueue({ gesture: "sideway_kick" });
    await f.flush();
    expect(sendEvents).toHaveBeenCalledTimes(2);
    expect(f.droppedEvents).toBe(0);
  });

  it("drops oldest events when queue exceeds max", () => {
    let counter = 0;
    const sendEvents = vi.fn().mockResolvedValue(true);
    const f = createForwarder(sendEvents, { maxQueue: 3, batchSize: 10 });
    f.enqueue({ id: ++counter });
    f.enqueue({ id: ++counter });
    f.enqueue({ id: ++counter });
    f.enqueue({ id: ++counter });
    expect(f.queue).toHaveLength(3);
    expect(f.droppedEvents).toBe(1);
    expect((f.queue[0] as any).id).toBe(2);
  });

  it("does not flush when already flushing", async () => {
    const sendEvents = vi.fn().mockImplementation(
      () => new Promise<void>((r) => setTimeout(r, 50)),
    );
    const f = createForwarder(sendEvents, {
      maxQueue: 10,
      batchSize: 5,
      retries: 0,
    });
    f.enqueue({ gesture: "cross_front" });
    // Two concurrent flushes — second should be no-op
    await Promise.all([f.flush(), f.flush()]);
    expect(sendEvents).toHaveBeenCalledTimes(1);
  });

  it("stops draining on permanent batch failure", async () => {
    const sendEvents = vi.fn().mockResolvedValue(false);
    const f = createForwarder(sendEvents, {
      maxQueue: 10,
      batchSize: 3,
      retries: 0,
      baseDelayMs: 1,
    });
    for (let i = 0; i < 6; i++) {
      f.enqueue({ id: i });
    }
    await f.flush();
    // Only the first batch was attempted; remaining 3 stayed in queue
    expect(f.queue).toHaveLength(3);
    expect(f.droppedEvents).toBe(3);
  });
});
