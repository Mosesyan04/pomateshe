import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verify-only copy of app/web/src/lib/whiteboard/room-token.ts's logic — this process never
 * issues tokens, only checks them (docs/WHITEBOARD.md §2: no Postgres credentials, no way to
 * look anything up, a signature + expiry is all it can ever verify). Deliberately duplicated,
 * not imported from app/web: this is a genuinely separate deployable process/package, and a
 * shared npm workspace for ~20 lines of stable HMAC-verification code isn't worth the tooling
 * (Правило 10 ТЗ). Requires AUTH_SECRET to be the SAME value in both processes' environments —
 * that's the only coupling between them.
 *
 * Keep this in sync by hand if room-token.ts's payload shape or signing scheme ever changes.
 */

export type WhiteboardRoomRole = "teacher" | "student";

export interface RoomTokenPayload {
  whiteboardId: string;
  teacherId: string;
  userId: string;
  role: WhiteboardRoomRole;
  expiresAt: number;
}

function getSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("AUTH_SECRET is not set — required to verify whiteboard room tokens.");
  }
  return secret;
}

function sign(payload: string): string {
  return createHmac("sha256", getSecret()).update(payload).digest("base64url");
}

export function verifyRoomToken(token: string, now: Date = new Date()): RoomTokenPayload | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [encoded, signature] = parts;

  const expectedSignature = sign(encoded);
  const signatureBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expectedSignature);
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
