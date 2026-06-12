import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer } from "http";
import { EventEmitter } from "events";
import WebSocket from "ws";
import { attachWsHub } from "../src-server/ws-hub.js";
import { createAuthModule } from "../src-server/auth.js";

const auth = createAuthModule({
  secret: "ws-hub-test-secret",
  adminPassword: "",
});

let httpServer: ReturnType<typeof createServer>;
let eventBus: EventEmitter;
let hub: ReturnType<typeof attachWsHub>;
let port: number;

function connect(): WebSocket {
  return new WebSocket(`ws://127.0.0.1:${port}`);
}

async function waitFor(cond: () => boolean, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error("waitFor timeout");
    await new Promise((r) => setTimeout(r, 20));
  }
}

beforeAll(async () => {
  httpServer = createServer();
  eventBus = new EventEmitter();
  hub = attachWsHub(httpServer, eventBus, {
    authGraceMs: 5000,
    verifyToken: auth.verifyToken,
  });

  await new Promise<void>((resolve) => {
    httpServer.listen(0, "127.0.0.1", () => {
      port = (httpServer.address() as any).port;
      resolve();
    });
  });
});

afterAll(() => {
  hub.close();
  httpServer.close();
});

describe("ws-hub", () => {
  it("sends hello after auth", async () => {
    const ws = connect();
    await new Promise((r) => ws.on("open", r));
    ws.send(JSON.stringify({ type: "auth", token: auth.signToken() }));

    const msg = await new Promise<any>((r) =>
      ws.on("message", (d) => r(JSON.parse(d.toString()))),
    );
    expect(msg.type).toBe("hello");
    expect(msg.clientId).toBeDefined();
    ws.close();
  });

  it("closes 4400 on invalid JSON", async () => {
    const ws = connect();
    await new Promise((r) => ws.on("open", r));
    ws.send("this is not json {{{");
    const code = await new Promise<number>((r) => ws.on("close", r));
    expect(code).toBe(4400);
  });

  it("closes 4400 on non-auth first message", async () => {
    const ws = connect();
    await new Promise((r) => ws.on("open", r));
    ws.send(JSON.stringify({ type: "ping" }));
    const code = await new Promise<number>((r) => ws.on("close", r));
    expect(code).toBe(4400);
  });

  it("closes 4403 on bad token", async () => {
    const ws = connect();
    await new Promise((r) => ws.on("open", r));
    ws.send(JSON.stringify({ type: "auth", token: "bad.token.here" }));
    const code = await new Promise<number>((r) => ws.on("close", r));
    expect(code).toBe(4403);
  });

  it("closes 4401 when no auth arrives within grace window", async () => {
    const ws = connect();
    await new Promise((r) => ws.on("open", r));
    const code = await new Promise<number>((r) => ws.on("close", r));
    expect(code).toBe(4401);
  }, 7000);

  it("closes 4401 quickly with short grace window", async () => {
    const shortHttp = createServer();
    const shortHub = attachWsHub(
      shortHttp,
      new EventEmitter(),
      { authGraceMs: 200, verifyToken: auth.verifyToken },
    );
    shortHttp.listen(0);
    const addr = shortHttp.address() as any;
    const shortPort = addr.port;
    const ws = new WebSocket(`ws://127.0.0.1:${shortPort}`);
    await new Promise((r) => ws.on("open", r));
    const code = await new Promise<number>((r) => ws.on("close", r));
    expect(code).toBe(4401);
    shortHub.close();
  }, 5000);

  it("broadcasts fern events to authed clients only", async () => {
    const authed = connect();
    const stranger = connect();
    const authedMsgs: any[] = [];
    const strangerMsgs: any[] = [];

    authed.on("message", (d) => authedMsgs.push(JSON.parse(d.toString())));
    stranger.on("message", (d) => strangerMsgs.push(JSON.parse(d.toString())));

    await Promise.all([
      new Promise((r) => authed.on("open", r)),
      new Promise((r) => stranger.on("open", r)),
    ]);

    authed.send(JSON.stringify({ type: "auth", token: auth.signToken() }));
    await waitFor(() => authedMsgs.some((m) => m.type === "hello"));

    eventBus.emit("fern_event", {
      cameraId: "phone1",
      event: "gesture",
      timestampMs: Date.now(),
      payload: { gesture: "heel_tap", confidence: 0.93 },
    });

    await waitFor(() => authedMsgs.some((m) => m.type === "fern_event"));
    expect(strangerMsgs.some((m) => m.type === "fern_event")).toBe(false);
    authed.close();
    stranger.close();
  });
});
