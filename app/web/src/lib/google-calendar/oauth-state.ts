import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signed, TTL-bound `state` param for the Google OAuth flow (docs/CALENDAR.md §2,
 * docs/THREAT_MODEL.md §5 — CSRF in the OAuth callback). Stateless on purpose: no DB row to
 * clean up, verification is just "does the signature check out, and hasn't it expired" —
 * the same shape as everything else in docs/AUTH.md that avoids a server-side session store
 * for a short-lived, single-use flow.
 *
 * Reuses AUTH_SECRET (already documented in .env.example as "signs session tokens /
 * password-reset tokens") rather than introducing a new env var for one more short-lived
 * signed token.
 */

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes — plenty for a user to complete Google's consent screen.

function getSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("AUTH_SECRET is not set — required to sign the OAuth state param.");
  }
  return secret;
}

function sign(payload: string): string {
  return createHmac("sha256", getSecret()).update(payload).digest("base64url");
}

/** teacherId is a cuid2 (lowercase alphanumeric) — never contains "." — safe as a field here. */
export function signOauthState(teacherId: string): string {
  const payload = `${teacherId}.${Date.now() + STATE_TTL_MS}`;
  return Buffer.from(`${payload}.${sign(payload)}`, "utf8").toString("base64url");
}

export function verifyOauthState(state: string): { teacherId: string } | null {
  let decoded: string;
  try {
    decoded = Buffer.from(state, "base64url").toString("utf8");
  } catch {
    return null;
  }

  const parts = decoded.split(".");
  if (parts.length !== 3) return null;
  const [teacherId, expiresAtRaw, signature] = parts;

  const expectedSignature = sign(`${teacherId}.${expiresAtRaw}`);
  const signatureBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expectedSignature);
  // Length check first — timingSafeEqual throws (not "returns false") on mismatched lengths.
  if (signatureBuf.length !== expectedBuf.length || !timingSafeEqual(signatureBuf, expectedBuf)) {
    return null;
  }

  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return null;

  return { teacherId };
}
