import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";

/**
 * Local-disk storage adapter — a Phase 2 stand-in, NOT the production design
 * (docs/FILE_STORAGE.md §2 requires an S3-compatible provider with an RF data center). Two
 * reasons this exists instead of real S3, both environmental rather than architectural:
 * this sandbox has no Docker daemon and its egress proxy blocks even downloading a local
 * MinIO binary (checked: dl.min.io is rejected), so a real S3-compatible endpoint can't be
 * stood up or tested here. See docs/FILE_STORAGE.md §2.1 for the swap plan.
 *
 * Deliberately lives behind the same narrow interface (save/read/delete by opaque key) a
 * real S3 adapter would expose, so swapping the backend later touches only this file, not
 * src/server/homework.ts or the API routes that call it.
 *
 * Files live in var/uploads/, outside Next's `public/` — anything under `public/` is served
 * unauthenticated by Next.js itself, which would defeat the ownership checks in
 * src/app/api/files/[teacherId]/[materialFileId]/route.ts entirely.
 */

const UPLOADS_ROOT = resolve(process.cwd(), "var", "uploads");

function resolveStoragePath(key: string): string {
  const full = resolve(UPLOADS_ROOT, key);
  // storageKey is always server-generated (cuid2, never client input, see
  // src/server/homework.ts), but this check is defense-in-depth against path traversal
  // regardless — the same principle as parameterizing SQL even for server-trusted values
  // (docs/MULTI_TENANCY.md §2.1).
  if (!full.startsWith(UPLOADS_ROOT)) {
    throw new Error("Invalid storage key.");
  }
  return full;
}

export async function saveFile(key: string, data: Buffer): Promise<void> {
  const path = resolveStoragePath(key);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, data);
}

export async function readStoredFile(key: string): Promise<Buffer> {
  return readFile(resolveStoragePath(key));
}

export async function deleteStoredFile(key: string): Promise<void> {
  await unlink(resolveStoragePath(key)).catch(() => {
    // Already gone is fine — delete is called from cleanup paths where "not found" isn't an error.
  });
}
