import type { WebSocket, RawData } from "ws";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import * as syncProtocol from "y-protocols/sync";
import * as awarenessProtocol from "y-protocols/awareness";
import type { Room } from "./room.js";
import { closeRoomIfEmpty } from "./room.js";
import type { RoomTokenPayload } from "./room-token.js";
import { verifyRoomToken } from "./room-token.js";
import { isOversized, createMessageRateLimiter, MAX_MESSAGE_BYTES } from "./connection-limits.js";

/**
 * Wire protocol — the same two-message-type shape y-websocket popularized (messageSync = 0,
 * messageAwareness = 1), plus one addition of our own (messageAuthRenew = 2). Re-implemented
 * directly on top of y-protocols/lib0 rather than depending on the y-websocket package's own
 * server, because that package assumes a trusted connection with no hooks for our auth model
 * (per-token TTL, continuous re-validation, forced disconnect on expiry —
 * docs/WHITEBOARD.md §2, §3, review-2).
 */
const messageSync = 0;
const messageAwareness = 1;
/** Client → server only: a fresh token from the keep-alive re-fetch (docs/WHITEBOARD.md §3 —
 *  "переиздание каждые 5-10 минут"), payload = the raw token string as UTF-8. Lets an
 *  already-open connection keep going past its original token's `exp` without a reconnect,
 *  while still re-running real verification on every renewal — never just resetting the timer
 *  because the client asked to. */
const messageAuthRenew = 2;

// WebSocket close codes: 1008 = Policy Violation (RFC 6455) — used for every auth-related
// close in this file, distinct from a normal 1000 (client left the lesson) or an internal 1011.
const CLOSE_POLICY_VIOLATION = 1008;

function toUint8Array(data: RawData): Uint8Array {
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data));
  if (Buffer.isBuffer(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return new Uint8Array(data);
}

function send(ws: WebSocket, data: Uint8Array): void {
  if (ws.readyState !== ws.OPEN) return;
  ws.send(data);
}

/**
 * Wires one connection into a room's shared Y.Doc/Awareness, and owns that connection's whole
 * auth lifecycle: the initial token that got it here, a timer that force-closes it the moment
 * the CURRENT token's `exp` passes (even mid-session — a WebSocket being technically still
 * open is not the same as the connection remaining authorized), renewal via messageAuthRenew,
 * and per-message rate/size limits (docs/THREAT_MODEL.md §4).
 */
export function setupConnection(ws: WebSocket, room: Room, initialPayload: RoomTokenPayload): void {
  room.connections.add(ws);
  const clientAwarenessIds = new Set<number>();
  const allowMessage = createMessageRateLimiter();
  let currentPayload = initialPayload;
  let expTimer: ReturnType<typeof setTimeout>;

  const scheduleExpiry = (payload: RoomTokenPayload) => {
    clearTimeout(expTimer);
    // Never negative/zero-delay-looping — a token that's already effectively expired by the
    // time we get here still gets one tick to close cleanly, not an immediate recursive timer.
    expTimer = setTimeout(() => ws.close(CLOSE_POLICY_VIOLATION, "token expired"), Math.max(payload.expiresAt - Date.now(), 0));
  };
  scheduleExpiry(currentPayload);

  // --- Initial sync handshake (client-initiates-first is the documented y-protocols model:
  // "The client should initiate the connection with SyncStep1", see sync.d.ts) — the SERVER
  // sends step1 immediately here too, so a client that's slow to speak still gets synced;
  // whichever side's step1 arrives second is what actually drives step2 in reply. ---
  {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageSync);
    syncProtocol.writeSyncStep1(encoder, room.doc);
    send(ws, encoding.toUint8Array(encoder));
  }
  const awarenessStates = room.awareness.getStates();
  if (awarenessStates.size > 0) {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageAwareness);
    encoding.writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(room.awareness, Array.from(awarenessStates.keys())),
    );
    send(ws, encoding.toUint8Array(encoder));
  }

  // --- Broadcast: forward the shared doc's updates and awareness changes to THIS connection,
  // skipping updates that originated from this same connection (origin === ws) to avoid
  // echoing a client's own edit back to itself. One listener pair per connection, registered
  // on the shared room.doc/room.awareness — the standard y-websocket fan-out shape. ---
  const onDocUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === ws) return;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageSync);
    syncProtocol.writeUpdate(encoder, update);
    send(ws, encoding.toUint8Array(encoder));
  };
  room.doc.on("update", onDocUpdate);

  const onAwarenessUpdate = (
    { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ) => {
    if (origin === ws) return;
    const changedClients = added.concat(updated, removed);
    if (changedClients.length === 0) return;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageAwareness);
    encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(room.awareness, changedClients));
    send(ws, encoding.toUint8Array(encoder));
  };
  room.awareness.on("change", onAwarenessUpdate);

  // Track which awareness client IDs this connection is responsible for, purely by watching
  // what it ever reports as "added"/"updated" in a change it itself originated — so on
  // disconnect we know exactly which states to clear (never guess/clear someone else's).
  const trackOwnAwarenessIds = (
    { added, updated }: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ) => {
    if (origin !== ws) return;
    for (const id of added.concat(updated)) clientAwarenessIds.add(id);
  };
  room.awareness.on("update", trackOwnAwarenessIds);

  ws.on("message", (raw: RawData) => {
    const data = toUint8Array(raw);

    if (isOversized(data.byteLength)) {
      ws.close(CLOSE_POLICY_VIOLATION, `message exceeds ${MAX_MESSAGE_BYTES} bytes`);
      return;
    }
    if (!allowMessage()) return; // soft drop — see connection-limits.ts's rationale

    const decoder = decoding.createDecoder(data);
    const messageType = decoding.readVarUint(decoder);

    switch (messageType) {
      case messageSync: {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, messageSync);
        syncProtocol.readSyncMessage(decoder, encoder, room.doc, ws);
        // readSyncMessage only writes a reply for step1 (server owes the client step2); for
        // a plain update or step2, the encoder stays at just the message-type byte — skip
        // sending an empty reply.
        if (encoding.length(encoder) > 1) send(ws, encoding.toUint8Array(encoder));
        break;
      }
      case messageAwareness: {
        awarenessProtocol.applyAwarenessUpdate(room.awareness, decoding.readVarUint8Array(decoder), ws);
        break;
      }
      case messageAuthRenew: {
        const token = new TextDecoder().decode(decoding.readVarUint8Array(decoder));
        const renewed = verifyRoomToken(token);
        // A renewal must prove the SAME identity this connection was opened with — never lets
        // one open socket silently reassign itself to a different room/user by presenting an
        // otherwise-valid token for someone else's board.
        if (
          renewed &&
          renewed.whiteboardId === currentPayload.whiteboardId &&
          renewed.teacherId === currentPayload.teacherId &&
          renewed.userId === currentPayload.userId
        ) {
          currentPayload = renewed;
          scheduleExpiry(renewed);
        }
        // An invalid/mismatched renewal is silently ignored, not fatal on its own — the
        // existing timer (from the last valid token) still governs; if that one also lapses,
        // the connection closes on schedule regardless.
        break;
      }
      // Any other message type is ignored, not fatal — forward wire-compatibility for a
      // future message type this build doesn't understand yet shouldn't kill the session.
    }
  });

  ws.on("close", () => {
    clearTimeout(expTimer);
    room.connections.delete(ws);
    room.doc.off("update", onDocUpdate);
    room.awareness.off("change", onAwarenessUpdate);
    room.awareness.off("update", trackOwnAwarenessIds);
    if (clientAwarenessIds.size > 0) {
      awarenessProtocol.removeAwarenessStates(room.awareness, Array.from(clientAwarenessIds), null);
    }
    closeRoomIfEmpty(room.whiteboardId);
  });

  ws.on("error", () => {
    // 'close' still fires after 'error' for a ws connection — no separate cleanup needed here,
    // this handler exists only so an unhandled 'error' event doesn't crash the process
    // (Node's EventEmitter throws if an 'error' event has no listener at all).
  });
}
