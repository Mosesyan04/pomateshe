"use client";

import { useSyncExternalStore } from "react";
import { POLICY_VERSION } from "../../lib/legal/policy-version";
import { recordCookieAnalyticsConsentAction } from "../cookie-consent-actions";

const STORAGE_KEY = "pomateshe_cookie_consent";
const CHANGE_EVENT = "pomateshe:cookie-consent-changed";

interface StoredChoice {
  choice: "accepted" | "declined";
  version: string;
}

function subscribe(callback: () => void) {
  // "storage" fires in OTHER tabs when localStorage changes, never in the tab that wrote it —
  // store() below dispatches CHANGE_EVENT itself so this tab's own click re-renders too.
  window.addEventListener("storage", callback);
  window.addEventListener(CHANGE_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(CHANGE_EVENT, callback);
  };
}

function getSnapshot(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const stored: StoredChoice | null = raw ? JSON.parse(raw) : null;
    // No stored choice, or it was given for an older revision of the cookie policy — show the
    // banner again rather than silently carrying an outdated consent forward.
    return !stored || stored.version !== POLICY_VERSION;
  } catch {
    // localStorage can throw (private browsing, blocked site data) — fail open to showing
    // the banner rather than crashing the page.
    return true;
  }
}

function getServerSnapshot(): boolean {
  // Never render the banner in the server-generated HTML — the real answer only exists in
  // the browser's localStorage, which the server can't see.
  return false;
}

function store(choice: StoredChoice["choice"]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ choice, version: POLICY_VERSION }));
  } catch {
    // Best-effort only — see docs/CONSENTS.md §3.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/**
 * docs/CONSENTS.md §3: necessary cookies (session auth) never need this banner — it only
 * gates analytics, which aren't wired up on the platform yet (the /legal/cookies page says so
 * explicitly). Declining costs nothing — the choice is recorded for later, not enforced against
 * anything today.
 */
export function CookieBanner() {
  const visible = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-label="Согласие на использование cookie"
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        background: "#1a1a1a",
        color: "#fff",
        padding: "1rem",
        display: "flex",
        gap: "1rem",
        alignItems: "center",
        flexWrap: "wrap",
        zIndex: 1000,
      }}
    >
      <p style={{ margin: 0, flex: "1 1 320px" }}>
        Мы используем необходимые cookie для работы сайта и, с вашего согласия, аналитические —
        подробнее в{" "}
        <a href="/legal/cookies" style={{ color: "#9cf" }}>
          Политике использования cookie
        </a>
        .
      </p>
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <button type="button" onClick={() => store("declined")} style={{ padding: "0.5rem 1rem" }}>
          Отклонить
        </button>
        <button
          type="button"
          onClick={() => {
            store("accepted");
            recordCookieAnalyticsConsentAction().catch(() => {});
          }}
          style={{ padding: "0.5rem 1rem" }}
        >
          Принять
        </button>
      </div>
    </div>
  );
}
