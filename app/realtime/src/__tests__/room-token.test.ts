import { describe, it, expect, beforeAll } from "vitest";
import { createHmac } from "node:crypto";
import { verifyRoomToken, type RoomTokenPayload } from "../room-token.js";

const SECRET = "test-realtime-room-token-secret";

function sign(payload: RoomTokenPayload): string {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encoded}.${createHmac("sha256", SECRET).update(encoded).digest("base64url")}`;
}

function payload(overrides: Partial<RoomTokenPayload> = {}): RoomTokenPayload {
  return {
    whiteboardId: "wb-1",
    teacherId: "teacher-1",
    userId: "user-1",
    role: "teacher",
    expiresAt: Date.now() + 60_000,
    ...overrides,
  };
}

describe("verifyRoomToken (realtime's verify-only copy)", () => {
  beforeAll(() => {
    process.env.AUTH_SECRET = SECRET;
  });

  it("accepts a validly-signed, unexpired token", () => {
    const p = payload();
    expect(verifyRoomToken(sign(p))).toEqual(p);
  });

  it("rejects an expired token", () => {
    expect(verifyRoomToken(sign(payload({ expiresAt: Date.now() - 1 })))).toBeNull();
  });

  it("rejects a token signed with a different secret", () => {
    const token = sign(payload());
    const original = process.env.AUTH_SECRET;
    process.env.AUTH_SECRET = "a-different-secret";
    expect(verifyRoomToken(token)).toBeNull();
    process.env.AUTH_SECRET = original;
  });

  it("rejects malformed input without throwing", () => {
    expect(verifyRoomToken("")).toBeNull();
    expect(verifyRoomToken("no-dot-here")).toBeNull();
    expect(verifyRoomToken("a.b.c")).toBeNull();
  });

  it("rejects a token whose role isn't teacher/student", () => {
    const encoded = Buffer.from(JSON.stringify({ ...payload(), role: "admin" }), "utf8").toString("base64url");
    const forged = `${encoded}.${createHmac("sha256", SECRET).update(encoded).digest("base64url")}`;
    expect(verifyRoomToken(forged)).toBeNull();
  });
});
