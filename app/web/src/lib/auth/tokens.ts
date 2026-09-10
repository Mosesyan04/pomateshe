import { randomBytes, createHash } from "node:crypto";

/**
 * Shared by sessions, password-reset tokens, and student invites — all three follow the
 * same rule from docs/AUTH.md §2: only the hash is ever persisted, the raw value exists
 * only in the URL/cookie handed to the user, so a DB leak never yields a directly usable
 * credential.
 */

export function generateOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashOpaqueToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
