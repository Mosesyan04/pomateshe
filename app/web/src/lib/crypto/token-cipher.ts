import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";

/**
 * AES-256-GCM at-rest encryption for OAuth tokens (docs/SECURITY.md §7) — used to store
 * CalendarIntegration.accessTokenEncrypted/refreshTokenEncrypted, never the raw token. The
 * key itself is NOT in the DB (env var only, rotated separately from DB backups per the same
 * doc), so a DB leak alone never yields a usable Google Calendar credential.
 *
 * Format: `${iv}.${authTag}.${ciphertext}`, each base64 — GCM's auth tag is what turns a
 * tampered/corrupted ciphertext into a thrown error on decrypt rather than garbage output.
 */

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH_BYTES = 12;

function getKey(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "TOKEN_ENCRYPTION_KEY is not set — required to encrypt/decrypt Google Calendar tokens. " +
        "Generate with `openssl rand -base64 32`. See .env.example.",
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(
      "TOKEN_ENCRYPTION_KEY must decode (base64) to exactly 32 bytes for AES-256 — " +
        "generate with `openssl rand -base64 32`.",
    );
  }
  return key;
}

export function encryptToken(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv, authTag, ciphertext].map((buf) => buf.toString("base64")).join(".");
}

export function decryptToken(encrypted: string): string {
  const key = getKey();
  const parts = encrypted.split(".");
  if (parts.length !== 3) {
    throw new Error("Malformed encrypted token — expected `iv.authTag.ciphertext`.");
  }
  const [ivB64, authTagB64, ciphertextB64] = parts;
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(authTagB64, "base64");
  const ciphertext = Buffer.from(ciphertextB64, "base64");

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  // Throws (GCM auth tag mismatch) if the ciphertext was tampered with or the key is wrong —
  // never silently returns corrupted plaintext.
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
