import "dotenv/config";
import { createServer, type Server } from "node:http";
import { WebSocketServer } from "ws";
import { verifyRoomToken } from "./room-token.js";
import { getOrCreateRoom } from "./room.js";
import { setupConnection } from "./connection.js";

/**
 * Whiteboard realtime service — docs/WHITEBOARD.md §2. Deliberately not part of the Next.js
 * process: a long-lived WebSocket connection doesn't fit the request/response model most
 * hosting treats Next.js under, and keeping this small and separate limits blast radius (a
 * bug here can't touch Postgres — this process has no DB credentials at all, see room-token.ts).
 */

export interface RealtimeServer {
  httpServer: Server;
  wss: WebSocketServer;
  close: () => Promise<void>;
}

/** Factory, not a module-load side effect — so tests can start/stop instances on ephemeral
 *  ports without the whole file auto-listening the moment it's imported. */
export function createRealtimeServer(): RealtimeServer {
  const httpServer = createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Pomateshe realtime whiteboard service\n");
  });

  const wss = new WebSocketServer({ noServer: true });

  // Auth happens BEFORE the WebSocket handshake completes (not "upgrade then immediately
  // close") — an invalid/missing token gets a plain HTTP 401 and the TCP socket is torn down,
  // never spending a WS upgrade on a request that was never going to be allowed to do anything.
  httpServer.on("upgrade", (request, socket, head) => {
    socket.on("error", () => {
      // A client that disconnects mid-handshake shouldn't crash the process — same reasoning
      // as connection.ts's ws 'error' handler.
    });

    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    const token = url.searchParams.get("token");

    if (!token) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    const payload = verifyRoomToken(token);
    if (!payload) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      const room = getOrCreateRoom(payload.whiteboardId);
      setupConnection(ws, room, payload);
    });
  });

  const close = () =>
    new Promise<void>((resolve) => {
      wss.close();
      httpServer.close(() => resolve());
      // Force-resolve if graceful close hangs (an open WS connection can otherwise block it
      // forever) — matters for tests as much as for the real SIGTERM handler below.
      setTimeout(resolve, 5000).unref();
    });

  return { httpServer, wss, close };
}

// Only actually listen when this file is run directly (`node dist/server.js` /
// `tsx src/server.ts`), not when createRealtimeServer is imported for tests.
if (import.meta.url === `file://${process.argv[1]}`) {
  const PORT = Number(process.env.PORT ?? 3101);
  const { httpServer } = createRealtimeServer();
  httpServer.listen(PORT, () => {
    console.log(`[realtime] listening on :${PORT}`);
  });

  const shutdown = (signal: string) => {
    console.log(`[realtime] received ${signal}, shutting down`);
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}
