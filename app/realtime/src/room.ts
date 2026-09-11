import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import type { WebSocket } from "ws";
import { loadSnapshot, saveSnapshot } from "./snapshot-storage.js";

/**
 * In-memory registry of active rooms, one per whiteboardId — docs/WHITEBOARD.md §4/§7: state
 * lives in process memory only while at least one client is connected, that's the actual
 * limiting resource at this scale (memory, not CPU).
 *
 * Snapshot persistence (docs/WHITEBOARD.md §4): a room restores from its last saved snapshot
 * the moment it's created, and saves periodically while there have been edits since the last
 * save, plus once more right before it's torn down. Losing the last few seconds/minutes of
 * unsaved edits on a crash is an accepted tradeoff (docs/WHITEBOARD.md §4), not a bug to design
 * around further.
 */

/** Product constant, not architectural — how often a dirty room's state is flushed to disk
 *  while there's at least one open connection. docs/WHITEBOARD.md §4 example value. */
const SNAPSHOT_SAVE_INTERVAL_MS = 30_000;

/** `Y.Doc.on("update", ...)` origin tag for updates applied by restoring a snapshot, so the
 *  dirty-tracking listener below doesn't treat "we just loaded our own last save" as new
 *  activity worth writing straight back out again. */
const RESTORE_ORIGIN = "snapshot-restore";

export interface Room {
  whiteboardId: string;
  teacherId: string;
  doc: Y.Doc;
  awareness: Awareness;
  connections: Set<WebSocket>;
}

interface RoomInternals {
  dirtySinceLastSave: boolean;
  saveTimer: ReturnType<typeof setInterval>;
}

const rooms = new Map<string, Room>();
const internals = new Map<string, RoomInternals>();

function persistSnapshot(room: Room): void {
  const update = Y.encodeStateAsUpdate(room.doc);
  saveSnapshot(room.teacherId, room.whiteboardId, update).catch((err: unknown) => {
    console.error(`[realtime] failed to save snapshot for whiteboard ${room.whiteboardId}:`, err);
  });
}

export function getOrCreateRoom(
  whiteboardId: string,
  teacherId: string,
  snapshotIntervalMs: number = SNAPSHOT_SAVE_INTERVAL_MS,
): Room {
  const existing = rooms.get(whiteboardId);
  if (existing) return existing;

  const doc = new Y.Doc();
  const awareness = new Awareness(doc);
  const room: Room = { whiteboardId, teacherId, doc, awareness, connections: new Set() };
  rooms.set(whiteboardId, room);

  // Fire-and-forget restore — docs/WHITEBOARD.md §4 already accepts a small window of lost
  // recent edits on crash, so it's fine for this to race the very first connection: any
  // content applied after that connection's own initial sync flows to it as a normal live doc
  // update (the same "update" event / broadcast path connection.ts uses for a real peer's
  // edit), not a special case that has to complete before the room is usable.
  void loadSnapshot(teacherId, whiteboardId)
    .then((snapshot) => {
      // Guard against the (rare) case where the room was already torn down and possibly
      // recreated again before this async read resolved — never apply a stale restore to the
      // wrong Room instance.
      if (snapshot && rooms.get(whiteboardId) === room) {
        Y.applyUpdate(doc, snapshot, RESTORE_ORIGIN);
      }
    })
    .catch((err: unknown) => {
      console.error(`[realtime] failed to restore snapshot for whiteboard ${whiteboardId}:`, err);
    });

  const state: RoomInternals = {
    dirtySinceLastSave: false,
    saveTimer: setInterval(() => {
      if (!state.dirtySinceLastSave) return; // nothing changed since the last flush — skip
      state.dirtySinceLastSave = false;
      persistSnapshot(room);
    }, snapshotIntervalMs),
  };
  state.saveTimer.unref(); // never keeps the process alive on its own
  internals.set(whiteboardId, state);

  doc.on("update", (_update: Uint8Array, origin: unknown) => {
    if (origin === RESTORE_ORIGIN) return;
    state.dirtySinceLastSave = true;
  });

  return room;
}

/** Call after removing a connection from room.connections — frees the Y.Doc once nobody is
 *  left, so an idle room doesn't hold memory indefinitely (docs/WHITEBOARD.md §7). Flushes one
 *  last snapshot first if there's unsaved activity, so closing the only connection right after
 *  an edit doesn't lose it to the next save interval that will now never fire. */
export function closeRoomIfEmpty(whiteboardId: string): void {
  const room = rooms.get(whiteboardId);
  if (!room || room.connections.size > 0) return;

  const state = internals.get(whiteboardId);
  if (state) {
    clearInterval(state.saveTimer);
    internals.delete(whiteboardId);
    if (state.dirtySinceLastSave) persistSnapshot(room);
  }

  room.awareness.destroy();
  room.doc.destroy();
  rooms.delete(whiteboardId);
}

/** Test-only introspection — never used by production code paths. */
export function _roomCountForTests(): number {
  return rooms.size;
}

export function _getRoomForTests(whiteboardId: string): Room | undefined {
  return rooms.get(whiteboardId);
}
