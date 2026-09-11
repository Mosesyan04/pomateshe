import { unlink } from "node:fs/promises";
import { resolve } from "node:path";

/**
 * Delete-only counterpart to app/realtime/src/snapshot-storage.ts. app/web never WRITES a
 * whiteboard snapshot — only the realtime process does that (docs/WHITEBOARD.md §2, §4) — but
 * the retention cron (docs/WHITEBOARD.md §5, src/server/whiteboard-retention.ts) has to delete
 * the object once a Whiteboard's retention window has passed.
 *
 * Points at the SAME absolute directory as app/realtime's WHITEBOARD_SNAPSHOT_DIR — see that
 * file's comment for why this local-disk stand-in needs both processes configured to agree on
 * one physical location (a real S3 bucket wouldn't have this constraint).
 */

function getRoot(): string {
  const dir = process.env.WHITEBOARD_SNAPSHOT_DIR;
  if (!dir) {
    throw new Error("WHITEBOARD_SNAPSHOT_DIR is not set — required to delete whiteboard snapshots.");
  }
  return resolve(dir);
}

function keyFor(teacherId: string, whiteboardId: string): string {
  return `teachers/${teacherId}/whiteboards/${whiteboardId}/snapshot.bin`;
}

export async function deleteWhiteboardSnapshot(teacherId: string, whiteboardId: string): Promise<void> {
  const root = getRoot();
  const full = resolve(root, keyFor(teacherId, whiteboardId));
  if (!full.startsWith(root)) {
    throw new Error("Invalid snapshot storage key.");
  }
  await unlink(full).catch((err) => {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    // Already gone (board never had any activity saved, or a retry after a previous partial
    // run) is fine — same convention as local-disk-storage.ts's deleteStoredFile.
  });
}
