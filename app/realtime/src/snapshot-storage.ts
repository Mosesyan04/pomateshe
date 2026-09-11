import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";

/**
 * Local-disk stand-in for the S3-compatible object store docs/FILE_STORAGE.md §2 describes —
 * same environmental reason as app/web/src/lib/files/local-disk-storage.ts (no Docker/S3-
 * compatible server reachable in this sandbox). A SEPARATE copy, not a shared import, for the
 * same reason room-token.ts is duplicated rather than imported from app/web: this is a
 * genuinely separate deployable process with no npm workspace linking it to app/web.
 *
 * The key `teachers/{teacherId}/whiteboards/{whiteboardId}/snapshot.bin` (docs/FILE_STORAGE.md
 * §3) is computed here, never read from a database column — this process has no Postgres
 * access at all (docs/WHITEBOARD.md §2) and must be able to derive its own storage key from
 * the token claims it already verified, with no lookup.
 *
 * WHITEBOARD_SNAPSHOT_DIR must be the exact same absolute path configured in app/web's
 * environment too — see .env.example. app/web's retention cron deletes the same object this
 * process writes/reads, and in this local-disk stand-in phase that only works if both
 * processes agree on one physical directory (a real S3 bucket wouldn't have this constraint —
 * both sides would just hold the same bucket credentials, docs/WHITEBOARD.md §4).
 */

function getRoot(): string {
  const dir = process.env.WHITEBOARD_SNAPSHOT_DIR;
  if (!dir) {
    throw new Error("WHITEBOARD_SNAPSHOT_DIR is not set — required to persist whiteboard snapshots.");
  }
  return resolve(dir);
}

function keyFor(teacherId: string, whiteboardId: string): string {
  return `teachers/${teacherId}/whiteboards/${whiteboardId}/snapshot.bin`;
}

function resolveStoragePath(key: string): string {
  const root = getRoot();
  const full = resolve(root, key);
  // teacherId/whiteboardId always come from an HMAC-verified token payload (never raw client
  // input), but this guard is defense-in-depth regardless — same principle as local-disk-
  // storage.ts's identical check.
  if (!full.startsWith(root)) {
    throw new Error("Invalid snapshot storage key.");
  }
  return full;
}

export async function saveSnapshot(teacherId: string, whiteboardId: string, data: Uint8Array): Promise<void> {
  const path = resolveStoragePath(keyFor(teacherId, whiteboardId));
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, data);
}

/** Returns null if no snapshot has ever been saved for this board — a brand-new room, not an error. */
export async function loadSnapshot(teacherId: string, whiteboardId: string): Promise<Uint8Array | null> {
  try {
    const buf = await readFile(resolveStoragePath(keyFor(teacherId, whiteboardId)));
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

/** Test-only escape hatch — production code never deletes a snapshot from this process (the
 *  retention cron in app/web does that, docs/WHITEBOARD.md §5). */
export async function _deleteSnapshotForTests(teacherId: string, whiteboardId: string): Promise<void> {
  await unlink(resolveStoragePath(keyFor(teacherId, whiteboardId))).catch(() => {});
}
