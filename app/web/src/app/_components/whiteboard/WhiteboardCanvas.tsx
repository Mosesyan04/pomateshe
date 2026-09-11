"use client";

import { useEffect, useState } from "react";
import { Tldraw, createTLStore, defaultShapeUtils, defaultBindingUtils, type TLStore } from "tldraw";
import "tldraw/tldraw.css";
import { getAssetUrls } from "@tldraw/assets/selfHosted";
import { connectStoreToRealtime, type WhiteboardConnectionStatus } from "../../../lib/whiteboard/yjs-store-binding";
import { createWhiteboardAssetStore } from "../../../lib/whiteboard/asset-store";

// Self-hosted, never fetched from cdn.tldraw.com — see scripts/copy-tldraw-assets.mjs and this
// app's strict CSP (docs/SECURITY.md §6, no external origins allowed).
const TLDRAW_ASSET_URLS = getAssetUrls({ baseUrl: "/tldraw-assets" });

interface TokenResponse {
  ok: boolean;
  token?: string;
  realtimeUrl?: string | null;
  error?: string;
  availableFrom?: string;
}

async function fetchToken(lessonId: string): Promise<TokenResponse> {
  const res = await fetch(`/api/whiteboard/${lessonId}/token`, { method: "POST" });
  return res.json();
}

const STATUS_LABELS: Record<WhiteboardConnectionStatus, string> = {
  connecting: "Подключение…",
  online: "Онлайн",
  offline: "Нет соединения — пробуем переподключиться…",
};

/** Mounted only from a page that has already server-side verified the current user may open
 *  this lesson's board (docs/WHITEBOARD.md §3) — this component re-derives its own token from
 *  the same check on mount (and periodically after), it never trusts being reachable as proof
 *  of access on its own. */
export function WhiteboardCanvas({ lessonId }: { lessonId: string }) {
  const [store] = useState<TLStore>(() =>
    createTLStore({ shapeUtils: defaultShapeUtils, bindingUtils: defaultBindingUtils, assets: createWhiteboardAssetStore(lessonId) }),
  );
  const [status, setStatus] = useState<WhiteboardConnectionStatus>("connecting");
  const [fatalError, setFatalError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let disconnect: (() => void) | null = null;

    async function start() {
      const initial = await fetchToken(lessonId);
      if (cancelled) return;
      if (!initial.ok || !initial.token) {
        setFatalError(
          initial.error === "outside_window"
            ? `Доска станет доступна к началу занятия${initial.availableFrom ? " (" + new Date(initial.availableFrom).toLocaleString("ru-RU") + ")" : ""}.`
            : "Доска недоступна.",
        );
        return;
      }
      if (!initial.realtimeUrl) {
        setFatalError("Realtime-сервис не настроен.");
        return;
      }

      disconnect = connectStoreToRealtime(store, {
        realtimeUrl: initial.realtimeUrl,
        token: initial.token,
        onStatusChange: setStatus,
        renewToken: async () => {
          const renewed = await fetchToken(lessonId);
          return renewed.ok && renewed.token ? renewed.token : null;
        },
      });
    }

    void start();
    return () => {
      cancelled = true;
      disconnect?.();
    };
  }, [lessonId, store]);

  if (fatalError) {
    return <p style={{ color: "#666", padding: "1rem" }}>{fatalError}</p>;
  }

  return (
    <div style={{ position: "relative", height: "80vh", minHeight: 480, border: "1px solid #ddd" }}>
      <div
        style={{
          position: "absolute",
          top: 4,
          right: 8,
          zIndex: 1000,
          fontSize: "0.8rem",
          color: status === "online" ? "#2a7" : "#a72",
          background: "rgba(255,255,255,0.85)",
          padding: "0.15rem 0.5rem",
          borderRadius: 4,
        }}
      >
        {STATUS_LABELS[status]}
      </div>
      <Tldraw store={store} assetUrls={TLDRAW_ASSET_URLS} />
    </div>
  );
}
