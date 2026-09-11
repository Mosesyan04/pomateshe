import type { TLAssetStore } from "tldraw";

/**
 * tldraw's hook for image insertion (docs/WHITEBOARD.md §2, §9 decision 4) — uploads through
 * POST /api/whiteboard/:lessonId/assets (same-origin, session-cookie auth, re-validated
 * server-side against this lesson's whiteboard access) and resolves straight to the
 * authorized GET route as the asset's `src` — no signed URL/CDN, same reasoning as the
 * homework-photo file route (this app has no cross-origin need for these files).
 */
export function createWhiteboardAssetStore(lessonId: string): TLAssetStore {
  return {
    async upload(_asset, file) {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`/api/whiteboard/${lessonId}/assets`, { method: "POST", body: formData });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        throw new Error(`Не удалось загрузить изображение (${body.error ?? res.status}).`);
      }
      return { src: `/api/whiteboard/${lessonId}/assets/${body.assetId}` };
    },
    resolve(asset) {
      return asset.props.src;
    },
  };
}
