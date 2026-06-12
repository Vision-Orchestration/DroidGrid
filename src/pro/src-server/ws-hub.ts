/**
 * WebSocket hub for DroidGrid Pro.
 *
 * - Each client must send {type:"auth", token:"..."} within AUTH_GRACE_MS
 * - Invalid JSON → close 4400
 * - Auth timeout    → close 4401
 * - Bad token       → close 4403
 * - Authed clients receive "hello" + broadcast "fern_event" from the addon bus
 */

import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import type { EventEmitter } from "events";
import { verifyToken as defaultVerifyToken } from "./auth.js";

interface WsHubOptions {
  authGraceMs?: number;
  verifyToken?: (token: string) => boolean;
}

interface AuthedClient {
  ws: WebSocket;
  id: string;
}

const DEFAULT_AUTH_GRACE_MS = 5000;

export function attachWsHub(
  httpServer: Server,
  eventBus: EventEmitter,
  options: WsHubOptions = {},
) {
  const authGraceMs = options.authGraceMs ?? DEFAULT_AUTH_GRACE_MS;
  const verifyToken = options.verifyToken ?? defaultVerifyToken;
  const wss = new WebSocketServer({ server: httpServer });
  const clients = new Map<WebSocket, AuthedClient>();

  wss.on("connection", (ws) => {
    let authed = false;
    let clientId = `ws_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const authTimer = setTimeout(() => {
      if (!authed) {
        ws.close(4401, "auth timeout");
      }
    }, authGraceMs);

    ws.on("message", (raw) => {
      if (authed) return;

      let msg: unknown;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        ws.close(4400, "invalid JSON");
        return;
      }

      const parsed = msg as { type?: string; token?: string };
      if (parsed?.type !== "auth" || !parsed?.token) {
        ws.close(4400, "expected auth message");
        return;
      }

      if (!verifyToken(parsed.token)) {
        ws.close(4403, "bad token");
        return;
      }

      authed = true;
      clearTimeout(authTimer);

      if (parsed.token) {
        clientId = `ws_${Date.now()}`;
      }

      clients.set(ws, { ws, id: clientId });
      ws.send(JSON.stringify({ type: "hello", clientId }));
    });

    ws.on("close", () => {
      clearTimeout(authTimer);
      clients.delete(ws);
    });

    ws.on("error", () => {
      clearTimeout(authTimer);
      clients.delete(ws);
    });
  });

  // Broadcast FERN events to all authenticated clients
  eventBus.on("fern_event", (data: unknown) => {
    const payload = JSON.stringify({ type: "fern_event", data });
    for (const [, client] of clients) {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(payload);
      }
    }
  });

  return {
    wss,
    connectedClients: () => clients.size,
    close: () => wss.close(),
  };
}
