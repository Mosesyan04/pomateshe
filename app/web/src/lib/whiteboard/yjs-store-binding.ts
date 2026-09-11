import * as Y from "yjs";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import * as syncProtocol from "y-protocols/sync";
import type { TLStore, TLRecord } from "tldraw";

/**
 * Binds a tldraw TLStore to app/realtime over WebSocket via a shared Y.Doc — the "thin adapter"
 * docs/WHITEBOARD.md §2/§9 anticipated (tldraw has no official Yjs package, only its own
 * @tldraw/sync protocol, which this project does NOT use — the wire protocol between client and
 * realtime service is Yjs, already built and verified in app/realtime; only the browser-side
 * binding was left open).
 *
 * Every tldraw record (document, page, shapes, everything in RecordScope "document") is mirrored
 * 1:1 into a single Y.Map<TLRecord> keyed by record id. This is deliberately a full-store mirror,
 * not a field-level CRDT of shape properties — simpler to reason about and correct at the board
 * sizes docs/WHITEBOARD.md §7 expects (KB-MB, not the kind of scale where per-field merge granularity
 * would matter). "presence"/"session" scoped records (camera position, selected tool, cursor) are
 * deliberately excluded — this MVP does not render live collaborator cursors (docs/WHITEBOARD.md's
 * MVP requirement is shared drawing, not presence UI); the wire protocol already reserves
 * messageAwareness for that as a documented, un-built follow-on, not a silent gap.
 */

const messageSync = 0;
// const messageAwareness = 1; — reserved, not used by this MVP binding (see module doc comment).
const messageAuthRenew = 2;

/** Origin tag for transactions caused by OUR OWN local edits — anything else (the initial
 *  restore, another peer's edit relayed by the server) is treated as remote. */
const LOCAL_ORIGIN = "local-edit";

export type WhiteboardConnectionStatus = "connecting" | "online" | "offline";

export interface ConnectStoreToRealtimeOptions {
  realtimeUrl: string;
  /** The room token to connect with initially. */
  token: string;
  /** Called periodically (docs/WHITEBOARD.md §3 — "переиздание каждые 5-10 минут") to fetch a
   *  fresh token from POST /api/whiteboard/:lessonId/token — re-runs the full ownership + access-
   *  window check server-side, same as a fresh connect. Also called before each reconnect attempt.
   *  Returning null means "no longer allowed" — the caller should stop retrying. */
  renewToken: () => Promise<string | null>;
  onStatusChange?: (status: WhiteboardConnectionStatus) => void;
}

const RENEW_INTERVAL_MS = 5 * 60 * 1000;
const MAX_RECONNECT_ATTEMPTS = 6;

/** Connects `store` to the realtime service and keeps it in sync until the returned cleanup
 *  function is called. */
export function connectStoreToRealtime(store: TLStore, opts: ConnectStoreToRealtimeOptions): () => void {
  const doc = new Y.Doc();
  const records = doc.getMap<TLRecord>("tlrecords");

  let ws: WebSocket | null = null;
  let stopped = false;
  let currentToken = opts.token;
  let reconnectAttempts = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

  const unlistenLocal = store.listen(
    (entry) => {
      doc.transact(() => {
        for (const record of Object.values(entry.changes.added)) records.set(record.id, record);
        for (const [, to] of Object.values(entry.changes.updated)) records.set(to.id, to);
        for (const record of Object.values(entry.changes.removed)) records.delete(record.id);
      }, LOCAL_ORIGIN);
    },
    { source: "user", scope: "document" },
  );

  /** Full resync from the shared Y.Map into the local store — simpler and, at this board scale,
   *  cheap enough to just do wholesale rather than compute a precise diff on every remote change.
   *
   *  Deliberately does NOT touch the store at all while the shared Y.Map is still empty (a
   *  brand-new board nobody has seeded yet) — createTLStore() always seeds its OWN store with a
   *  document + page record first (fixed, well-known ids like "document:document"), and those
   *  are required for the editor to function at all (Editor.getCurrentPageId() throws without
   *  one). Wiping them out the moment an empty remote doc arrives crashed the editor outright —
   *  caught via a real browser run, not a type error. seedIfEmpty() below is what actually
   *  publishes that local seed into the shared doc for the first connection to a new board;
   *  every later connection instead receives that already-seeded content and this function
   *  replaces the connecting client's OWN freshly-generated (and therefore different) seed
   *  with the canonical shared one, same as any other remote record. */
  function applyYjsStateToStore() {
    const idsInDoc = new Set(records.keys());
    if (idsInDoc.size === 0) return;

    store.mergeRemoteChanges(() => {
      const toRemove = store.allRecords().filter((r) => !idsInDoc.has(r.id));
      if (toRemove.length > 0) store.remove(toRemove.map((r) => r.id));

      const toPut: TLRecord[] = [];
      for (const id of idsInDoc) {
        const record = records.get(id);
        if (record) toPut.push(record);
      }
      if (toPut.length > 0) store.put(toPut);
    });
  }

  /** Publishes the local store's current (freshly seeded) records into the shared Y.Map if
   *  nobody has published anything there yet — idempotent by construction (tldraw's document/
   *  page seed records use fixed ids, so two clients racing to seed a brand-new board at once
   *  just write the same content to the same keys, not a real conflict). Called after every
   *  incoming sync message rather than only once, so it also recovers if the doc is ever
   *  observed empty for any other reason. */
  function seedIfEmpty() {
    if (records.size > 0) return;
    doc.transact(() => {
      for (const record of store.allRecords()) records.set(record.id, record);
    }, LOCAL_ORIGIN);
  }

  const onAfterTransaction = (transaction: Y.Transaction) => {
    if (transaction.origin === LOCAL_ORIGIN) return; // our own edit, already reflected in the store
    applyYjsStateToStore();
  };
  doc.on("afterTransaction", onAfterTransaction);

  // The other half of the sync loop: whenever OUR OWN edits (local store changes, or the
  // one-time seed) change the local Y.Doc, push that update out over the wire — this is what
  // actually gets a local edit to the server (and from there, to every other connected peer).
  // Without this, local edits stayed local forever: the store→Y.Map direction worked, but
  // nothing ever sent the resulting doc update to app/realtime at all.
  const onDocUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin !== LOCAL_ORIGIN) return; // an update applied FROM the server, not to send back
    if (!ws || ws.readyState !== ws.OPEN) return; // dropped mid-edit — the reconnect resync covers it
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageSync);
    syncProtocol.writeUpdate(encoder, update);
    ws.send(encoding.toUint8Array(encoder));
  };
  doc.on("update", onDocUpdate);

  function sendAuthRenewal(token: string) {
    if (!ws || ws.readyState !== ws.OPEN) return;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageAuthRenew);
    encoding.writeVarUint8Array(encoder, new TextEncoder().encode(token));
    ws.send(encoding.toUint8Array(encoder));
  }

  function connect() {
    opts.onStatusChange?.("connecting");
    const socket = new WebSocket(`${opts.realtimeUrl}?token=${encodeURIComponent(currentToken)}`);
    socket.binaryType = "arraybuffer";
    ws = socket;

    socket.addEventListener("open", () => {
      reconnectAttempts = 0;
      opts.onStatusChange?.("online");
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, messageSync);
      syncProtocol.writeSyncStep1(encoder, doc);
      socket.send(encoding.toUint8Array(encoder));
    });

    socket.addEventListener("message", (event) => {
      const data = new Uint8Array(event.data as ArrayBuffer);
      const decoder = decoding.createDecoder(data);
      const messageType = decoding.readVarUint(decoder);
      if (messageType !== messageSync) return; // messageAwareness ignored, see module doc comment

      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, messageSync);
      syncProtocol.readSyncMessage(decoder, encoder, doc, "remote-sync");
      if (encoding.length(encoder) > 1) socket.send(encoding.toUint8Array(encoder));
      seedIfEmpty();
    });

    socket.addEventListener("close", () => {
      ws = null;
      if (stopped) return;
      opts.onStatusChange?.("offline");
      reconnectAttempts += 1;
      if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) return; // give up — UI should suggest a reload
      const delayMs = Math.min(1000 * reconnectAttempts, 5000);
      reconnectTimer = setTimeout(() => {
        void opts.renewToken().then((fresh) => {
          if (stopped) return;
          if (!fresh) return; // no longer allowed (e.g. lesson window closed) — stop retrying
          currentToken = fresh;
          connect();
        });
      }, delayMs);
    });

    socket.addEventListener("error", () => {
      // 'close' always follows 'error' for a browser WebSocket — reconnect logic lives there.
    });
  }

  connect();
  const renewTimer = setInterval(() => {
    void opts.renewToken().then((fresh) => {
      if (stopped || !fresh) return;
      currentToken = fresh;
      sendAuthRenewal(fresh);
    });
  }, RENEW_INTERVAL_MS);

  return () => {
    stopped = true;
    unlistenLocal();
    doc.off("afterTransaction", onAfterTransaction);
    doc.off("update", onDocUpdate);
    doc.destroy();
    clearInterval(renewTimer);
    if (reconnectTimer) clearTimeout(reconnectTimer);
    ws?.close();
  };
}
