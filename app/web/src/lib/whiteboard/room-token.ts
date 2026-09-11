import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signed room token for the whiteboard's realtime service (docs/WHITEBOARD.md §3). Stateless
 * by design — the realtime service has no Postgres credentials (docs/WHITEBOARD.md §2), so it
 * can only ever verify a signature + expiry, never look anything up. Reuses AUTH_SECRET (same
 * choice already made for the Google Calendar OAuth `state` param, src/lib/google-calendar/
 * oauth-state.ts) rather than a new env var — both are short-lived signed tokens for an
 * internal purpose, not user-facing credentials.
 *
 * `app/realtime` (the separate WebSocket process, not yet built) verifies these tokens with
 * its OWN small copy of the verify logic below, not by importing this file — it's a
 * genuinely separate deployable process/package, and this file lives under app/web's own
 * src/lib. Duplicating ~20 lines of HMAC verification is simpler than standing up a shared
 * npm workspace package for one small, stable piece of logic (Правило 10 ТЗ) — a change here
 * needs a matching change there, which is an accepted, documented tradeoff, not an oversight.
 */

export type WhiteboardRoomRole = "teacher" | "student";

export interface RoomTokenPayload {
  whiteboardId: string;
  teacherId: string;
  userId: string;
  role: WhiteboardRoomRole;
  /** Epoch milliseconds — not a Date, so the token round-trips through JSON without a reviver. */
  expiresAt: number;
}

function getSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("AUTH_SECRET is not set — required to sign whiteboard room tokens.");
  }
  return secret;
}

function sign(payload: string): string {
  return createHmac("sha256", getSecret()).update(payload).digest("base64url");
}

export function signRoomToken(payload: RoomTokenPayload): string {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encoded}.${sign(encoded)}`;
}

/**
 * Returns the verified payload, or null for anything wrong — malformed, tampered, wrong
 * signature (secret rotated, forged), or expired. Never throws on bad input; a token off the
 * wire is fully untrusted data.
 */
export function verifyRoomToken(token: string, now: Date = new Date()): RoomTokenPayload | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [encoded, signature] = parts;

  const expectedSignature = sign(encoded);
  const signatureBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expectedSignature);
  // Length check first — timingSafeEqual throws (not "returns false") on mismatched lengths,
  // same guard as oauth-state.ts's signature check.
  if (signatureBuf.length !== expectedBuf.length || !timingSafeEqual(signatureBuf, expectedBuf)) {
    return null;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!isRoomTokenPayload(payload)) return null;
  if (now.getTime() > payload.expiresAt) return null;

  return payload;
}

function isRoomTokenPayload(value: unknown): value is RoomTokenPayload {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.whiteboardId === "string" &&
    typeof v.teacherId === "string" &&
    typeof v.userId === "string" &&
    (v.role === "teacher" || v.role === "student") &&
    typeof v.expiresAt === "number"
  );
}
