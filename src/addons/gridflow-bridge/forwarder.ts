/**
 * Extracted retry-queue forwarder for the GridFlow Bridge addon.
 *
 * Pure function — no network, no timers. Tests inject `sendEvents` and
 * drive the queue with explicit `enqueue()` / `flush()` calls.
 */

export interface ForwarderOptions {
  maxQueue?: number;
  batchSize?: number;
  retries?: number;
  baseDelayMs?: number;
}

export interface Forwarder {
  enqueue(event: unknown): void;
  flush(): Promise<void>;
  readonly queue: unknown[];
  readonly droppedEvents: number;
}

export type SendEventsFn = (
  batch: unknown[],
  attempt: number,
) => Promise<boolean>;

export function createForwarder(
  sendEvents: SendEventsFn,
  options: ForwarderOptions = {},
): Forwarder {
  const maxQueue = options.maxQueue ?? 100;
  const batchSize = options.batchSize ?? 10;
  const retries = options.retries ?? 3;

  const eventQueue: unknown[] = [];
  let droppedEvents = 0;
  let flushing = false;

  function enqueue(event: unknown) {
    if (eventQueue.length >= maxQueue) {
      eventQueue.shift();
      droppedEvents++;
    }
    eventQueue.push(event);
  }

  async function flush() {
    if (flushing || eventQueue.length === 0) return;
    flushing = true;

    while (eventQueue.length > 0) {
      const batch = eventQueue.splice(0, batchSize);
      let success = false;

      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          const ok = await sendEvents(batch, attempt);
          if (ok) { success = true; break; }
          if (attempt === retries) {
            droppedEvents += batch.length;
            break;
          }
        } catch {
          if (attempt === retries) {
            droppedEvents += batch.length;
            break;
          }
          await new Promise((r) => setTimeout(r, options.baseDelayMs ?? 500 * 2 ** attempt));
        }
      }

      if (!success) break;
    }

    flushing = false;
  }

  return {
    enqueue,
    flush,
    get queue() { return eventQueue; },
    get droppedEvents() { return droppedEvents; },
  };
}
