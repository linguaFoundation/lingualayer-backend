import test from "node:test";
import assert from "node:assert";
import Fastify from "fastify";
import websocket from "@fastify/websocket";
import { wsRoutes } from "./ws.js";
import { WebSocket as WsWebSocket } from "ws";
import { upsertCommission, resetCommissionStore } from "../services/commission-indexer.js";

// WebSocket became a global in Node 22. On Node 20 — which CI pins, and which
// this previously failed on with "WebSocket is not defined" — it is absent, so
// fall back to the ws implementation @fastify/websocket already depends on.
const WebSocketImpl: typeof globalThis.WebSocket =
  globalThis.WebSocket ?? (WsWebSocket as unknown as typeof globalThis.WebSocket);

test("WS /ws/commissions broadcasts newly-indexed commissions", async () => {
  resetCommissionStore();
  const app = Fastify();
  await app.register(websocket);
  await app.register(wsRoutes);
  await app.listen({ port: 0, host: "127.0.0.1" });

  const address = app.server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  const socket = new WebSocketImpl(`ws://127.0.0.1:${port}/ws/commissions`);

  try {
    const message = await new Promise<string>((resolve, reject) => {
      socket.addEventListener("open", () => {
        upsertCommission({
          id: "c1",
          commissioner: "GABC",
          bountyAmountUsdc: 100,
          languageCode: "yo",
          state: "open",
          createdLedger: 1,
          updatedLedger: 1,
        });
      });
      socket.addEventListener("message", (event) => resolve(event.data.toString()));
      socket.addEventListener("error", () => reject(new Error("socket error")));
      const timer = setTimeout(() => reject(new Error("timed out waiting for broadcast")), 2000);
      // Cleared on success, or the pending timer keeps the loop alive.
      socket.addEventListener("message", () => clearTimeout(timer));
    });

    const parsed = JSON.parse(message);
    assert.strictEqual(parsed.type, "commission:new");
    assert.strictEqual(parsed.commission.id, "c1");
  } finally {
    socket.close();
    await app.close();
  }
});
