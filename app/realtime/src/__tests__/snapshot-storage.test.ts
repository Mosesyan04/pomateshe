import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveSnapshot, loadSnapshot } from "../snapshot-storage.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "wb-snapshot-test-"));
  process.env.WHITEBOARD_SNAPSHOT_DIR = tmpDir;
});

afterEach(async () => {
  delete process.env.WHITEBOARD_SNAPSHOT_DIR;
  await rm(tmpDir, { recursive: true, force: true });
});

describe("snapshot-storage", () => {
  it("returns null for a board that has never been saved", async () => {
    const result = await loadSnapshot("teacher-1", "board-1");
    expect(result).toBeNull();
  });

  it("round-trips exactly the bytes that were saved", async () => {
    const data = new Uint8Array([1, 2, 3, 255, 0, 128]);
    await saveSnapshot("teacher-1", "board-1", data);
    const loaded = await loadSnapshot("teacher-1", "board-1");
    expect(loaded).toEqual(data);
  });

  it("keeps different boards' snapshots fully separate", async () => {
    await saveSnapshot("teacher-1", "board-a", new Uint8Array([1]));
    await saveSnapshot("teacher-1", "board-b", new Uint8Array([2]));
    await saveSnapshot("teacher-2", "board-a", new Uint8Array([3]));

    expect(await loadSnapshot("teacher-1", "board-a")).toEqual(new Uint8Array([1]));
    expect(await loadSnapshot("teacher-1", "board-b")).toEqual(new Uint8Array([2]));
    expect(await loadSnapshot("teacher-2", "board-a")).toEqual(new Uint8Array([3]));
  });

  it("overwrites a previous snapshot for the same board on a later save", async () => {
    await saveSnapshot("teacher-1", "board-1", new Uint8Array([1, 1, 1]));
    await saveSnapshot("teacher-1", "board-1", new Uint8Array([2, 2]));
    expect(await loadSnapshot("teacher-1", "board-1")).toEqual(new Uint8Array([2, 2]));
  });

  it("throws a clear error when WHITEBOARD_SNAPSHOT_DIR is not configured", async () => {
    delete process.env.WHITEBOARD_SNAPSHOT_DIR;
    await expect(loadSnapshot("teacher-1", "board-1")).rejects.toThrow(/WHITEBOARD_SNAPSHOT_DIR/);
  });
});
