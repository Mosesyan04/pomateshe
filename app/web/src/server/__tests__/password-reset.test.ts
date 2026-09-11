import { describe, it, expect, afterAll, vi } from "vitest";
import { registerTeacher } from "../teachers";
import { createPasswordResetToken, resetPasswordWithToken } from "../../lib/auth/password-reset";
import { createSession, validateSession } from "../../lib/auth/session";
import { verifyPassword } from "../../lib/auth/password";
import { cleanupTestData } from "./test-helpers";
import { prisma } from "../db";

const createdUserIds: string[] = [];

afterAll(async () => {
  await cleanupTestData(createdUserIds);
  await prisma.$disconnect();
});

async function makeTeacher(label: string, password: string) {
  const t = await registerTeacher({
    email: `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
    password,
    displayName: `${label} teacher`,
    slug: `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    timezone: "Europe/Moscow",
  });
  createdUserIds.push(t.userId);
  return t;
}

describe("Password reset", () => {
  it("resets the password with a valid token, and the new password actually works", async () => {
    const teacher = await makeTeacher("pwreset-basic", "original password 123");
    const { token } = await createPasswordResetToken(teacher.userId);

    const result = await resetPasswordWithToken(token, "brand new password 456");
    expect(result.ok).toBe(true);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: teacher.userId } });
    expect(await verifyPassword(user.passwordHash, "brand new password 456")).toBe(true);
    expect(await verifyPassword(user.passwordHash, "original password 123")).toBe(false);
  });

  it("invalidates every existing session for the user on a successful reset", async () => {
    const teacher = await makeTeacher("pwreset-sessions", "original password 123");
    const sessionA = await createSession(teacher.userId);
    const sessionB = await createSession(teacher.userId);
    expect(await validateSession(sessionA.token)).not.toBeNull();
    expect(await validateSession(sessionB.token)).not.toBeNull();

    const { token } = await createPasswordResetToken(teacher.userId);
    await resetPasswordWithToken(token, "brand new password 456");

    expect(await validateSession(sessionA.token)).toBeNull();
    expect(await validateSession(sessionB.token)).toBeNull();
  });

  it("rejects a token that's already been used once", async () => {
    const teacher = await makeTeacher("pwreset-single-use", "original password 123");
    const { token } = await createPasswordResetToken(teacher.userId);

    const first = await resetPasswordWithToken(token, "first new password 456");
    expect(first.ok).toBe(true);

    const second = await resetPasswordWithToken(token, "second new password 789");
    expect(second).toEqual({ ok: false, reason: "invalid_or_expired" });

    // The password from the first (successful) reset must still be the one that works.
    const user = await prisma.user.findUniqueOrThrow({ where: { id: teacher.userId } });
    expect(await verifyPassword(user.passwordHash, "first new password 456")).toBe(true);
  });

  it("rejects an expired token", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const teacher = await makeTeacher("pwreset-expired", "original password 123");
    const { token } = await createPasswordResetToken(teacher.userId);

    vi.setSystemTime(new Date("2026-01-01T02:00:00Z")); // 2 hours later, TTL is 1 hour
    const result = await resetPasswordWithToken(token, "new password 456");
    vi.useRealTimers();

    expect(result).toEqual({ ok: false, reason: "invalid_or_expired" });
  });

  it("rejects a garbage/unknown token", async () => {
    const result = await resetPasswordWithToken("not-a-real-token", "new password 456");
    expect(result).toEqual({ ok: false, reason: "invalid_or_expired" });
  });
});
