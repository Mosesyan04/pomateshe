import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import type { WebSocket } from "ws";

/**
 * In-memory registry of active rooms, one per whiteboardId — docs/WHITEBOARD.md §4/§7: state
 * lives in process memory only while at least one client is connected, that's the actual
 * limiting resource at this scale (memory, not CPU). No snapshot restore/save yet — that's
 * the next commit; for now a room simply starts empty and is dropped the moment its last
 * connection closes (acceptable short-term: nothing persisted yet means nothing to lose that
 * wasn't already going to be lost on process restart either).
 */

export interface Room {
  whiteboardId: string;
  doc: Y.Doc;
  awareness: Awareness;
  connections: Set<WebSocket>;
}

const rooms = new Map<string, Room>();

export function getOrCreateRoom(whiteboardId: string): Room {
  const existing = rooms.get(whiteboardId);
  if (existing) return existing;

  const doc = new Y.Doc();
  const awareness = new Awareness(doc);
  const room: Room = { whiteboardId, doc, awareness, connections: new Set() };
  rooms.set(whiteboardId, room);
  return room;
}

/** Call after removing a connection from room.connections — frees the Y.Doc once nobody is
 *  left, so an idle room doesn't hold memory indefinitely (docs/WHITEBOARD.md §7). */
export function closeRoomIfEmpty(whiteboardId: string): void {
  const room = rooms.get(whiteboardId);
  if (!room || room.connections.size > 0) return;
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
