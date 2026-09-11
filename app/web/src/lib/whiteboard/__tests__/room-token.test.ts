import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signRoomToken, verifyRoomToken, type RoomTokenPayload } from "../room-token";

describe("whiteboard room token (signed, TTL-bound)", () => {
  const originalSecret = process.env.AUTH_SECRET;

  beforeAll(() => {
    process.env.AUTH_SECRET = "test-auth-secret-do-not-use-in-prod";
  });

  afterAll(() => {
    process.env.AUTH_SECRET = originalSecret;
  });

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

  it("round-trips a valid, freshly-signed token", () => {
    const original = payload();
    const token = signRoomToken(original);
    expect(verifyRoomToken(token)).toEqual(original);
  });

  it("rejects an expired token", () => {
    const token = signRoomToken(payload({ expiresAt: Date.now() - 1000 }));
    expect(verifyRoomToken(token)).toBeNull();
  });

  it("accepts a token right up to its exact expiry instant", () => {
    const exp = Date.now() + 5000;
    const token = signRoomToken(payload({ expiresAt: exp }));
    expect(verifyRoomToken(token, new Date(exp))).not.toBeNull();
    expect(verifyRoomToken(token, new Date(exp + 1))).toBeNull();
  });

  it("rejects a token signed with a different secret (tampered or a rotated secret)", () => {
    const token = signRoomToken(payload());
    process.env.AUTH_SECRET = "a-different-secret";
    expect(verifyRoomToken(token)).toBeNull();
    process.env.AUTH_SECRET = "test-auth-secret-do-not-use-in-prod";
  });

  it("rejects a token with a tampered payload (whiteboardId swapped after signing)", () => {
    const token = signRoomToken(payload({ whiteboardId: "wb-real" }));
    const [encodedPart, signaturePart] = token.split(".");
    const decoded = JSON.parse(Buffer.from(encodedPart, "base64url").toString("utf8"));
    decoded.whiteboardId = "wb-stolen";
    const forgedEncoded = Buffer.from(JSON.stringify(decoded), "utf8").toString("base64url");
    const forged = `${forgedEncoded}.${signaturePart}`;
    expect(verifyRoomToken(forged)).toBeNull();
  });

  it("rejects a role that isn't teacher/student", () => {
    const token = signRoomToken(payload());
    const [encodedPart] = token.split(".");
    const decoded = JSON.parse(Buffer.from(encodedPart, "base64url").toString("utf8"));
    decoded.role = "admin";
    // Re-sign with the tampered payload using the real secret, simulating a bug that produced
    // a bad role rather than an attacker — verifyRoomToken must still reject on shape alone.
    const reEncoded = Buffer.from(JSON.stringify(decoded), "utf8").toString("base64url");
    const resigned = signRoomToken(decoded as unknown as RoomTokenPayload);
    expect(resigned.startsWith(reEncoded)).toBe(true); // sanity: same payload bytes
    expect(verifyRoomToken(resigned)).toBeNull();
  });

  it("rejects garbage input instead of throwing", () => {
    expect(verifyRoomToken("")).toBeNull();
    expect(verifyRoomToken("not-a-token")).toBeNull();
    expect(verifyRoomToken("a.b.c")).toBeNull();
    expect(verifyRoomToken("onlyonepart")).toBeNull();
  });

  it("throws a clear error at sign/verify time when AUTH_SECRET is missing", () => {
    delete process.env.AUTH_SECRET;
    expect(() => signRoomToken(payload())).toThrow(/AUTH_SECRET/);
    process.env.AUTH_SECRET = "test-auth-secret-do-not-use-in-prod";
  });
});
