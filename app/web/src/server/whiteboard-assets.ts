import { createId } from "@paralleldrive/cuid2";
import { saveFile, readStoredFile } from "../lib/files/local-disk-storage";
import { detectImageType } from "../lib/files/detect-image-type";
import { resolveWhiteboardForTeacher, resolveWhiteboardForStudent } from "./whiteboard";

/**
 * Image insertion for the whiteboard (docs/WHITEBOARD.md §2, §9 decision 4) — through tldraw's
 * own asset-store hook, not embedded as base64 inside the Yjs document (would bloat the CRDT
 * doc and every snapshot). Reuses the SAME local-disk storage abstraction and magic-byte
 * validation already built for homework photos (src/server/homework.ts) — no new storage
 * subsystem, per the plan.
 *
 * No new DB table: an asset needs no metadata beyond its bytes and MIME type (re-detected from
 * magic bytes on read, never trusted from the upload or from the filename), so the opaque
 * storage key alone is enough, same as MaterialFile's key convention.
 */

const MAX_ASSET_BYTES = 10 * 1024 * 1024; // matches homework's photo limit — product constant

export interface WhiteboardAssetRequester {
  role: "teacher" | "student";
  teacherId?: string;
  studentUserId?: string;
}

async function resolveAccess(requester: WhiteboardAssetRequester, lessonId: string) {
  if (requester.role === "teacher" && requester.teacherId) {
    return resolveWhiteboardForTeacher(requester.teacherId, lessonId);
  }
  if (requester.role === "student" && requester.studentUserId) {
    return resolveWhiteboardForStudent(requester.studentUserId, lessonId);
  }
  return { ok: false, reason: "not_found" } as const;
}

function assetKey(teacherId: string, whiteboardId: string, assetId: string): string {
  return `${teacherId}/whiteboards/${whiteboardId}/assets/${assetId}`;
}

export type UploadWhiteboardAssetResult =
  | { ok: true; assetId: string; mimeType: string }
  | { ok: false; error: "not_found" | "outside_window" | "too_large" | "invalid_type" };

export async function uploadWhiteboardAsset(
  requester: WhiteboardAssetRequester,
  lessonId: string,
  data: Buffer,
): Promise<UploadWhiteboardAssetResult> {
  const access = await resolveAccess(requester, lessonId);
  if (!access.ok) return { ok: false, error: access.reason };

  if (data.byteLength > MAX_ASSET_BYTES) return { ok: false, error: "too_large" };

  // Magic bytes, not the client-supplied filename/MIME — same rationale as homework.ts.
  const mimeType = detectImageType(data);
  if (!mimeType) return { ok: false, error: "invalid_type" };

  const assetId = createId();
  await saveFile(assetKey(access.teacherId, access.whiteboardId, assetId), data);
  return { ok: true, assetId, mimeType };
}

export async function getWhiteboardAssetForAccess(
  requester: WhiteboardAssetRequester,
  lessonId: string,
  assetId: string,
): Promise<{ allowed: true; data: Buffer; mimeType: string } | { allowed: false }> {
  const access = await resolveAccess(requester, lessonId);
  if (!access.ok) return { allowed: false };

  try {
    const data = await readStoredFile(assetKey(access.teacherId, access.whiteboardId, assetId));
    const mimeType = detectImageType(data);
    if (!mimeType) return { allowed: false }; // only ever written via uploadWhiteboardAsset above
    return { allowed: true, data, mimeType };
  } catch {
    return { allowed: false };
  }
}
