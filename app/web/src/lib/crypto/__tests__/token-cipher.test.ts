import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { encryptToken, decryptToken } from "../token-cipher";

describe("token-cipher (AES-256-GCM at-rest encryption for OAuth tokens)", () => {
  const originalKey = process.env.TOKEN_ENCRYPTION_KEY;

  beforeAll(() => {
    process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  });

  afterAll(() => {
    process.env.TOKEN_ENCRYPTION_KEY = originalKey;
  });

  it("round-trips a plaintext token", () => {
    const plaintext = "ya29.a0AfH6SMC-example-access-token";
    const encrypted = encryptToken(plaintext);
    expect(decryptToken(encrypted)).toBe(plaintext);
  });

  it("produces a different ciphertext each time (random IV), even for the same plaintext", () => {
    const plaintext = "same-refresh-token";
    const a = encryptToken(plaintext);
    const b = encryptToken(plaintext);
    expect(a).not.toBe(b);
    expect(decryptToken(a)).toBe(plaintext);
    expect(decryptToken(b)).toBe(plaintext);
  });

  it("throws on a tampered ciphertext instead of returning corrupted plaintext", () => {
    const encrypted = encryptToken("a secret token");
    const [iv, authTag, ciphertext] = encrypted.split(".");
    const tamperedBuf = Buffer.from(ciphertext, "base64");
    tamperedBuf[0] = tamperedBuf[0] ^ 0xff;
    const tampered = [iv, authTag, tamperedBuf.toString("base64")].join(".");
    expect(() => decryptToken(tampered)).toThrow();
  });

  it("throws on a tampered auth tag", () => {
    const encrypted = encryptToken("a secret token");
    const [iv, authTag, ciphertext] = encrypted.split(".");
    const tamperedBuf = Buffer.from(authTag, "base64");
    tamperedBuf[0] = tamperedBuf[0] ^ 0xff;
    const tampered = [iv, tamperedBuf.toString("base64"), ciphertext].join(".");
    expect(() => decryptToken(tampered)).toThrow();
  });

  it("throws on a malformed encrypted string", () => {
    expect(() => decryptToken("not-the-right-shape")).toThrow(/Malformed/);
  });

  it("throws when TOKEN_ENCRYPTION_KEY is missing", () => {
    delete process.env.TOKEN_ENCRYPTION_KEY;
    expect(() => encryptToken("x")).toThrow(/TOKEN_ENCRYPTION_KEY/);
    process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  });

  it("throws when TOKEN_ENCRYPTION_KEY is the wrong length", () => {
    process.env.TOKEN_ENCRYPTION_KEY = randomBytes(16).toString("base64"); // AES-128, not 256
    expect(() => encryptToken("x")).toThrow(/32 bytes/);
    process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  });
});
