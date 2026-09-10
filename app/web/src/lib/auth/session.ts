import { prisma } from "../../server/db";
import { generateOpaqueToken, hashOpaqueToken } from "./tokens";

/**
 * Sessions are NOT tenant-scoped (docs/DATABASE.md §2 — no RLS on this table), so this
 * module talks to `prisma` directly rather than through withTenantContext, which is reserved
 * for tenant-scoped models (docs/MULTI_TENANCY.md §2.1).
 *
 * Only the SHA-256 hash of the session token is ever stored — see docs/AUTH.md §2. A leaked
 * DB dump or backup does not hand out usable session tokens; verifying a presented cookie
 * value means hashing it and looking up the hash, never comparing tokens directly.
 */

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days, docs/AUTH.md §5

export interface CreatedSession {
  /** The raw token — set this as the httpOnly session cookie. Never persisted anywhere. */
  token: string;
  expiresAt: Date;
}

export async function createSession(userId: string): Promise<CreatedSession> {
  const token = generateOpaqueToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await prisma.session.create({
    data: {
      userId,
      tokenHash: hashOpaqueToken(token),
      expiresAt,
    },
  });

  return { token, expiresAt };
}

export interface ValidatedSession {
  userId: string;
  role: "admin" | "teacher" | "student";
  /** Only set when role === "teacher" — see User.teacherProfileId in schema.prisma. */
  teacherProfileId: string | null;
}

/**
 * Looks up a presented cookie token and returns the associated user, or null if the token
 * is missing, expired, or unknown. Also refreshes lastUsedAt (sliding TTL is handled at the
 * cookie layer, not here — this only records activity).
 */
export async function validateSession(token: string): Promise<ValidatedSession | null> {
  const tokenHash = hashOpaqueToken(token);

  const session = await prisma.session.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!session || session.expiresAt < new Date() || session.user.disabledAt) {
    return null;
  }

  await prisma.session.update({
    where: { id: session.id },
    data: { lastUsedAt: new Date() },
  });

  return {
    userId: session.user.id,
    role: session.user.role,
    teacherProfileId: session.user.teacherProfileId,
  };
}

export async function revokeSession(token: string): Promise<void> {
  await prisma.session.deleteMany({ where: { tokenHash: hashOpaqueToken(token) } });
}

/** "Log out everywhere" — docs/AUTH.md §5. Also used when a role changes or a password is reset. */
export async function revokeAllSessionsForUser(userId: string): Promise<void> {
  await prisma.session.deleteMany({ where: { userId } });
}
