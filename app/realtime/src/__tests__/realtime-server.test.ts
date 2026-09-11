import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import type { AddressInfo } from "node:net";
import { createRealtimeServer, type RealtimeServer } from "../server.js";
import type { RoomTokenPayload } from "../room-token.js";

const TEST_SECRET = "test-realtime-secret-do-not-use-in-prod";

function signTestToken(payload: RoomTokenPayload): string {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", TEST_SECRET).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

function tokenPayload(overrides: Partial<RoomTokenPayload> = {}): RoomTokenPayload {
  return {
    whiteboardId: randomUUID(),
    teacherId: "teacher-1",
    userId: "user-1",
    role: "teacher",
    expiresAt: Date.now() + 60_000,
    ...overrides,
  };
}

let server: RealtimeServer;
let baseUrl: string;

beforeAll(() => {
  process.env.AUTH_SECRET = TEST_SECRET;
  // room.ts kicks off snapshot persistence for every room, regardless of which test created
  // it — deliberately unset here so these tests stay hermetic no matter what the invoking
  // shell happens to have exported, instead of silently depending on ambient env state to
  // decide whether snapshot save attempts are no-ops or real disk writes.
  delete process.env.WHITEBOARD_SNAPSHOT_DIR;
});

afterEach(async () => {
  if (server) await server.close();
});

async function startServer(): Promise<string> {
  server = createRealtimeServer();
  await new Promise<void>((resolve) => server.httpServer.listen(0, resolve));
  const { port } = server.httpServer.address() as AddressInfo;
  return `ws://localhost:${port}`;
}

function waitForOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
}

function waitForClose(ws: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve) => {
    ws.once("close", (code, reasonBuf) => resolve({ code, reason: reasonBuf.toString() }));
  });
}

/** Arms a `once("message", ...)` listener SYNCHRONOUSLY (the Promise executor runs
 *  immediately) — call this BEFORE awaiting `open`, never after. The server can send its
 *  initial sync message essentially as soon as the handshake completes, and awaiting `open`
 *  first leaves a real window where that message arrives with no listener attached yet, and
 *  is lost forever — the exact bug a first draft of this file had, caught by these tests
 *  hanging until timeout, not by a wrong assertion. */
function waitForMessage(ws: WebSocket): Promise<Uint8Array> {
  return new Promise((resolve) => {
    ws.once("message", (data) => resolve(new Uint8Array(data as Buffer)));
  });
}

/** Connects and returns once both the handshake is open AND the server's initial sync step1
 *  message has been consumed — the listener is armed before the open-wait even starts. */
async function connectAndConsumeInitialSync(url: string): Promise<WebSocket> {
  const ws = new WebSocket(url);
  const initialMessage = waitForMessage(ws);
  await waitForOpen(ws);
  await initialMessage;
  return ws;
}

describe("realtime whiteboard server — handshake auth", () => {
  it("rejects a connection with no token at all", async () => {
    baseUrl = await startServer();
    const ws = new WebSocket(`${baseUrl}/`);
    const openOrError = await Promise.race([
      waitForOpen(ws).then(() => "open"),
      new Promise((resolve) => ws.once("unexpected-response", () => resolve("rejected"))),
    ]);
    expect(openOrError).toBe("rejected");
  });

  it("rejects a connection with a garbage token", async () => {
    baseUrl = await startServer();
    const ws = new WebSocket(`${baseUrl}/?token=not-a-real-token`);
    const outcome = await Promise.race([
      waitForOpen(ws).then(() => "open"),
      new Promise((resolve) => ws.once("unexpected-response", () => resolve("rejected"))),
    ]);
    expect(outcome).toBe("rejected");
  });

  it("rejects a connection with an expired token", async () => {
    baseUrl = await startServer();
    const token = signTestToken(tokenPayload({ expiresAt: Date.now() - 1000 }));
    const ws = new WebSocket(`${baseUrl}/?token=${token}`);
    const outcome = await Promise.race([
      waitForOpen(ws).then(() => "open"),
      new Promise((resolve) => ws.once("unexpected-response", () => resolve("rejected"))),
    ]);
    expect(outcome).toBe("rejected");
  });

  it("accepts a connection with a valid token and sends an initial sync message", async () => {
    baseUrl = await startServer();
    const token = signTestToken(tokenPayload());
    const ws = new WebSocket(`${baseUrl}/?token=${token}`);
    const initialMessage = waitForMessage(ws);
    await waitForOpen(ws);
    const firstMessage = await initialMessage;
    // messageSync = 0, first byte of a varUint-encoded 0 is just 0x00.
    expect(firstMessage[0]).toBe(0);
    ws.close();
  });
});

describe("realtime whiteboard server — room isolation and sync fan-out", () => {
  it("two clients in the SAME room see updates from one another", async () => {
    baseUrl = await startServer();
    const whiteboardId = randomUUID();
    const tokenA = signTestToken(tokenPayload({ whiteboardId, userId: "user-a" }));
    const tokenB = signTestToken(tokenPayload({ whiteboardId, userId: "user-b" }));

    const wsA = new WebSocket(`${baseUrl}/?token=${tokenA}`);
    const wsB = new WebSocket(`${baseUrl}/?token=${tokenB}`);
    const initialA = waitForMessage(wsA);
    const initialB = waitForMessage(wsB);
    await Promise.all([waitForOpen(wsA), waitForOpen(wsB)]);
    await Promise.all([initialA, initialB]); // consume each one's initial sync step1

    // messageAwareness = 1, followed by a varUint8Array-encoded awareness update. Building a
    // real one from scratch (without a full y-protocols Awareness instance on the "client"
    // side) is more machinery than this test needs — instead, prove fan-out the simpler way:
    // send a raw Yjs doc update from A and confirm B receives a messageSync frame for it.
    const bNextMessage = waitForMessage(wsB);

    // A trivial Yjs update, constructed by round-tripping through a real Y.Doc, imported
    // lazily here only for building this one test fixture.
    const Y = await import("yjs");
    const doc = new Y.Doc();
    doc.getMap("test").set("k", "v");
    const update = Y.encodeStateAsUpdate(doc);

    const encoding = await import("lib0/encoding");
    const syncProtocol = await import("y-protocols/sync");
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 0); // messageSync
    syncProtocol.writeUpdate(encoder, update);
    wsA.send(encoding.toUint8Array(encoder));

    const received = await bNextMessage;
    expect(received[0]).toBe(0); // messageSync

    wsA.close();
    wsB.close();
  });

  it("clients in DIFFERENT rooms never see each other's updates", async () => {
    baseUrl = await startServer();
    const tokenA = signTestToken(tokenPayload({ whiteboardId: randomUUID(), userId: "user-a" }));
    const tokenB = signTestToken(tokenPayload({ whiteboardId: randomUUID(), userId: "user-b" }));

    const wsA = new WebSocket(`${baseUrl}/?token=${tokenA}`);
    const wsB = new WebSocket(`${baseUrl}/?token=${tokenB}`);
    const initialA = waitForMessage(wsA);
    const initialB = waitForMessage(wsB);
    await Promise.all([waitForOpen(wsA), waitForOpen(wsB)]);
    await Promise.all([initialA, initialB]);

    let bReceivedAnything = false;
    wsB.on("message", () => {
      bReceivedAnything = true;
    });

    const Y = await import("yjs");
    const doc = new Y.Doc();
    doc.getMap("test").set("k", "v");
    const update = Y.encodeStateAsUpdate(doc);
    const encoding = await import("lib0/encoding");
    const syncProtocol = await import("y-protocols/sync");
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 0);
    syncProtocol.writeUpdate(encoder, update);
    wsA.send(encoding.toUint8Array(encoder));

    await new Promise((resolve) => setTimeout(resolve, 200)); // give any (wrongful) fan-out time to arrive
    expect(bReceivedAnything).toBe(false);

    wsA.close();
    wsB.close();
  });
});

describe("realtime whiteboard server — token expiry and renewal", () => {
  it("force-closes a connection when its token expires, even while idle and technically open", async () => {
    baseUrl = await startServer();
    const token = signTestToken(tokenPayload({ expiresAt: Date.now() + 150 }));
    const ws = await connectAndConsumeInitialSync(`${baseUrl}/?token=${token}`);

    const { code } = await waitForClose(ws);
    expect(code).toBe(1008); // policy violation
  });

  it("a renewal with a fresh valid token for the SAME identity keeps the connection alive past the original expiry", async () => {
    baseUrl = await startServer();
    const whiteboardId = randomUUID();
    const shortToken = signTestToken(tokenPayload({ whiteboardId, userId: "user-1", expiresAt: Date.now() + 150 }));
    const ws = await connectAndConsumeInitialSync(`${baseUrl}/?token=${shortToken}`);

    // Renew with a token valid for much longer, same identity, BEFORE the short one expires.
    const renewalToken = signTestToken(tokenPayload({ whiteboardId, userId: "user-1", expiresAt: Date.now() + 5000 }));
    const encoding = await import("lib0/encoding");
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 2); // messageAuthRenew
    encoding.writeVarUint8Array(encoder, new TextEncoder().encode(renewalToken));
    ws.send(encoding.toUint8Array(encoder));

    // Give the original (short) token's expiry a chance to fire — connection must still be open.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(ws.readyState).toBe(ws.OPEN);

    ws.close();
  });

  it("ignores a renewal token for a DIFFERENT whiteboardId (no session hijacking), original timer still governs", async () => {
    baseUrl = await startServer();
    const whiteboardId = randomUUID();
    const shortToken = signTestToken(tokenPayload({ whiteboardId, userId: "user-1", expiresAt: Date.now() + 150 }));
    const ws = await connectAndConsumeInitialSync(`${baseUrl}/?token=${shortToken}`);

    const otherRoomToken = signTestToken(
      tokenPayload({ whiteboardId: randomUUID(), userId: "user-1", expiresAt: Date.now() + 5000 }),
    );
    const encoding = await import("lib0/encoding");
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 2);
    encoding.writeVarUint8Array(encoder, new TextEncoder().encode(otherRoomToken));
    ws.send(encoding.toUint8Array(encoder));

    const { code } = await waitForClose(ws);
    expect(code).toBe(1008); // still closed on the ORIGINAL schedule, renewal was ignored
  });
});

describe("realtime whiteboard server — message limits", () => {
  it("closes a connection that sends an oversized message", async () => {
    baseUrl = await startServer();
    const token = signTestToken(tokenPayload());
    const ws = await connectAndConsumeInitialSync(`${baseUrl}/?token=${token}`);

    const closePromise = waitForClose(ws);
    const oversized = new Uint8Array(300 * 1024); // over the 256 KiB cap
    ws.send(oversized);

    const { code } = await closePromise;
    expect(code).toBe(1008);
  });
});
