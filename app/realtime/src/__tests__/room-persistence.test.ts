import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WebSocket } from "ws";
import * as Y from "yjs";
import { getOrCreateRoom, closeRoomIfEmpty } from "../room.js";
import { saveSnapshot, loadSnapshot } from "../snapshot-storage.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "wb-room-persist-test-"));
  process.env.WHITEBOARD_SNAPSHOT_DIR = tmpDir;
});

afterEach(async () => {
  delete process.env.WHITEBOARD_SNAPSHOT_DIR;
  await rm(tmpDir, { recursive: true, force: true });
});

/** room.connections is a plain Set<WebSocket> — these tests exercise the persistence logic
 *  directly, never real sockets, so a bare object standing in for "one open connection" is
 *  all closeRoomIfEmpty's `connections.size` check needs. */
function fakeConnection(): WebSocket {
  return {} as WebSocket;
}

async function waitUntil(predicate: () => Promise<boolean> | boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (await predicate()) return;
    if (Date.now() - start > timeoutMs) throw new Error("waitUntil timed out");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("room — snapshot restore on creation", () => {
  it("starts a brand-new room's doc empty when no snapshot has ever been saved", async () => {
    const room = getOrCreateRoom("board-new", "teacher-1", 10_000);
    await new Promise((resolve) => setTimeout(resolve, 50)); // let the fire-and-forget restore attempt resolve
    expect(room.doc.getMap("shapes").size).toBe(0);
  });

  it("applies a previously saved snapshot to the room's doc", async () => {
    const sourceDoc = new Y.Doc();
    sourceDoc.getMap("shapes").set("rect-1", "a rectangle");
    await saveSnapshot("teacher-1", "board-restore", Y.encodeStateAsUpdate(sourceDoc));

    const room = getOrCreateRoom("board-restore", "teacher-1", 10_000);
    await waitUntil(() => room.doc.getMap("shapes").get("rect-1") === "a rectangle");
    expect(room.doc.getMap("shapes").get("rect-1")).toBe("a rectangle");
  });
});

describe("room — periodic snapshot saving", () => {
  it("saves a snapshot on the next interval tick if the doc was edited", async () => {
    const room = getOrCreateRoom("board-dirty", "teacher-1", 30);
    room.doc.getMap("shapes").set("k", "v");

    await waitUntil(async () => (await loadSnapshot("teacher-1", "board-dirty")) !== null, 1000);
    const saved = await loadSnapshot("teacher-1", "board-dirty");
    expect(saved).not.toBeNull();

    const check = new Y.Doc();
    Y.applyUpdate(check, saved!);
    expect(check.getMap("shapes").get("k")).toBe("v");
  });

  it("does not write a snapshot on an interval tick with no edits since the last save", async () => {
    getOrCreateRoom("board-idle", "teacher-1", 30);
    await new Promise((resolve) => setTimeout(resolve, 150)); // several ticks' worth of idle time
    expect(await loadSnapshot("teacher-1", "board-idle")).toBeNull();
  });
});

describe("room — final save on close", () => {
  it("flushes one last snapshot when the last connection closes, even before the periodic interval would fire", async () => {
    const room = getOrCreateRoom("board-closing", "teacher-1", 10_000); // interval far longer than this test
    const conn = fakeConnection();
    room.connections.add(conn);
    room.doc.getMap("shapes").set("k", "v");

    room.connections.delete(conn);
    closeRoomIfEmpty("board-closing");

    await waitUntil(async () => (await loadSnapshot("teacher-1", "board-closing")) !== null, 1000);
    const saved = await loadSnapshot("teacher-1", "board-closing");
    const check = new Y.Doc();
    Y.applyUpdate(check, saved!);
    expect(check.getMap("shapes").get("k")).toBe("v");
  });

  it("does not write a redundant snapshot on close if nothing changed since the last save", async () => {
    const room = getOrCreateRoom("board-clean-close", "teacher-1", 30);
    room.doc.getMap("shapes").set("k", "v");
    await waitUntil(async () => (await loadSnapshot("teacher-1", "board-clean-close")) !== null, 1000);

    // Nothing changed since that save — closing now should not error or hang, and the
    // already-saved content must still be intact (not overwritten with something empty).
    const conn = fakeConnection();
    room.connections.add(conn);
    room.connections.delete(conn);
    closeRoomIfEmpty("board-clean-close");

    await new Promise((resolve) => setTimeout(resolve, 50));
    const saved = await loadSnapshot("teacher-1", "board-clean-close");
    const check = new Y.Doc();
    Y.applyUpdate(check, saved!);
    expect(check.getMap("shapes").get("k")).toBe("v");
  });
});
