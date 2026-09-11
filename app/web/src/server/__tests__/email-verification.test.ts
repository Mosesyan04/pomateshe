import { describe, it, expect, afterAll, vi } from "vitest";
import { registerTeacher } from "../teachers";
import { createEmailVerificationToken, verifyEmailWithToken } from "../../lib/auth/email-verification";
import { createSession, validateSession } from "../../lib/auth/session";
import { cleanupTestData } from "./test-helpers";
import { prisma } from "../db";

const createdUserIds: string[] = [];

afterAll(async () => {
  await cleanupTestData(createdUserIds);
  await prisma.$disconnect();
});

async function makeTeacher(label: string) {
  const t = await registerTeacher({
    email: `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
    password: "correct horse battery staple",
    displayName: `${label} teacher`,
    slug: `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    timezone: "Europe/Moscow",
  });
  createdUserIds.push(t.userId);
  return t;
}

describe("Email verification", () => {
  it("a freshly-registered teacher has no emailVerifiedAt", async () => {
    const teacher = await makeTeacher("everify-fresh");
    const user = await prisma.user.findUniqueOrThrow({ where: { id: teacher.userId } });
    expect(user.emailVerifiedAt).toBeNull();
  });

  it("verifying with a valid token sets emailVerifiedAt", async () => {
    const teacher = await makeTeacher("everify-basic");
    const { token } = await createEmailVerificationToken(teacher.userId);

    const result = await verifyEmailWithToken(token);
    expect(result).toEqual({ ok: true, userId: teacher.userId });

    const user = await prisma.user.findUniqueOrThrow({ where: { id: teacher.userId } });
    expect(user.emailVerifiedAt).not.toBeNull();
  });

  it("rejects a token that's already been used once", async () => {
    const teacher = await makeTeacher("everify-single-use");
    const { token } = await createEmailVerificationToken(teacher.userId);

    const first = await verifyEmailWithToken(token);
    expect(first.ok).toBe(true);

    const second = await verifyEmailWithToken(token);
    expect(second).toEqual({ ok: false, reason: "invalid_or_expired" });
  });

  it("rejects an expired token", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const teacher = await makeTeacher("everify-expired");
    const { token } = await createEmailVerificationToken(teacher.userId);

    vi.setSystemTime(new Date("2026-01-02T01:00:00Z")); // 25 hours later, TTL is 24 hours
    const result = await verifyEmailWithToken(token);
    vi.useRealTimers();

    expect(result).toEqual({ ok: false, reason: "invalid_or_expired" });
  });

  it("rejects a garbage/unknown token", async () => {
    const result = await verifyEmailWithToken("not-a-real-token");
    expect(result).toEqual({ ok: false, reason: "invalid_or_expired" });
  });

  it("validateSession's emailVerifiedAt reflects the current DB state (null before, set after)", async () => {
    const teacher = await makeTeacher("everify-session");
    const session = await createSession(teacher.userId);

    const before = await validateSession(session.token);
    expect(before!.emailVerifiedAt).toBeNull();

    const { token } = await createEmailVerificationToken(teacher.userId);
    await verifyEmailWithToken(token);

    const after = await validateSession(session.token);
    expect(after!.emailVerifiedAt).not.toBeNull();
  });
});
