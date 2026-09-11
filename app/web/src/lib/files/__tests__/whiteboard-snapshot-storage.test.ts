import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deleteWhiteboardSnapshot } from "../whiteboard-snapshot-storage";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "wb-snapshot-storage-test-"));
  process.env.WHITEBOARD_SNAPSHOT_DIR = tmpDir;
});

afterEach(async () => {
  delete process.env.WHITEBOARD_SNAPSHOT_DIR;
  await rm(tmpDir, { recursive: true, force: true });
});

function keyPath(teacherId: string, whiteboardId: string): string {
  return join(tmpDir, "teachers", teacherId, "whiteboards", whiteboardId, "snapshot.bin");
}

describe("deleteWhiteboardSnapshot", () => {
  it("deletes an existing snapshot object", async () => {
    const path = keyPath("teacher-1", "board-1");
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, new Uint8Array([1, 2, 3]));

    await deleteWhiteboardSnapshot("teacher-1", "board-1");

    await expect(readFile(path)).rejects.toThrow();
  });

  it("does not throw when the snapshot was never saved (nothing to delete)", async () => {
    await expect(deleteWhiteboardSnapshot("teacher-1", "board-never-saved")).resolves.toBeUndefined();
  });

  it("only deletes the exact (teacherId, whiteboardId) it's asked to, leaving siblings alone", async () => {
    const target = keyPath("teacher-1", "board-a");
    const sibling = keyPath("teacher-1", "board-b");
    const otherTeacher = keyPath("teacher-2", "board-a");
    for (const p of [target, sibling, otherTeacher]) {
      await mkdir(join(p, ".."), { recursive: true });
      await writeFile(p, new Uint8Array([1]));
    }

    await deleteWhiteboardSnapshot("teacher-1", "board-a");

    await expect(readFile(target)).rejects.toThrow();
    expect(await readFile(sibling)).toEqual(Buffer.from([1]));
    expect(await readFile(otherTeacher)).toEqual(Buffer.from([1]));
  });

  it("throws a clear error when WHITEBOARD_SNAPSHOT_DIR is not configured", async () => {
    delete process.env.WHITEBOARD_SNAPSHOT_DIR;
    await expect(deleteWhiteboardSnapshot("teacher-1", "board-1")).rejects.toThrow(/WHITEBOARD_SNAPSHOT_DIR/);
  });
});
