import { hash, verify } from "@node-rs/argon2";

/**
 * Argon2id, not bcrypt — see docs/AUTH.md §2, docs/SECURITY.md §2. Default parameters from
 * @node-rs/argon2 already target Argon2id with OWASP-reasonable cost; revisit only if a
 * future audit says otherwise, not speculatively.
 */
export function hashPassword(plaintext: string): Promise<string> {
  return hash(plaintext);
}

export function verifyPassword(hashValue: string, plaintext: string): Promise<boolean> {
  return verify(hashValue, plaintext);
}
