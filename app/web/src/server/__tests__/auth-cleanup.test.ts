import { describe, it, expect, afterAll } from "vitest";
import { registerTeacher } from "../teachers";
import { cleanupExpiredAuthRecords } from "../auth-cleanup";
import { cleanupTestData } from "./test-helpers";
import { prisma } from "../db";
import { hashOpaqueToken } from "../../lib/auth/tokens";

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

const PAST = new Date(Date.now() - 60_000);
const FUTURE = new Date(Date.now() + 60 * 60_000);

describe("cleanupExpiredAuthRecords", () => {
  it("deletes only expired sessions, leaves active ones alone", async () => {
    const teacher = await makeTeacher("cleanup-sessions");
    const expired = await prisma.session.create({
      data: { userId: teacher.userId, tokenHash: hashOpaqueToken(`expired-${Date.now()}`), expiresAt: PAST },
    });
    const active = await prisma.session.create({
      data: { userId: teacher.userId, tokenHash: hashOpaqueToken(`active-${Date.now()}`), expiresAt: FUTURE },
    });

    await cleanupExpiredAuthRecords();

    expect(await prisma.session.findUnique({ where: { id: expired.id } })).toBeNull();
    expect(await prisma.session.findUnique({ where: { id: active.id } })).not.toBeNull();
  });

  it("deletes used AND expired password-reset tokens, leaves a fresh unused one alone", async () => {
    const teacher = await makeTeacher("cleanup-pwreset");
    const used = await prisma.passwordResetToken.create({
      data: {
        userId: teacher.userId,
        tokenHash: hashOpaqueToken(`used-${Date.now()}`),
        expiresAt: FUTURE,
        usedAt: new Date(),
      },
    });
    const expired = await prisma.passwordResetToken.create({
      data: { userId: teacher.userId, tokenHash: hashOpaqueToken(`expired-${Date.now()}`), expiresAt: PAST },
    });
    const fresh = await prisma.passwordResetToken.create({
      data: { userId: teacher.userId, tokenHash: hashOpaqueToken(`fresh-${Date.now()}`), expiresAt: FUTURE },
    });

    await cleanupExpiredAuthRecords();

    expect(await prisma.passwordResetToken.findUnique({ where: { id: used.id } })).toBeNull();
    expect(await prisma.passwordResetToken.findUnique({ where: { id: expired.id } })).toBeNull();
    expect(await prisma.passwordResetToken.findUnique({ where: { id: fresh.id } })).not.toBeNull();
  });

  it("deletes used AND expired email-verification tokens, leaves a fresh unused one alone", async () => {
    const teacher = await makeTeacher("cleanup-everify");
    const used = await prisma.emailVerificationToken.create({
      data: {
        userId: teacher.userId,
        tokenHash: hashOpaqueToken(`used-${Date.now()}`),
        expiresAt: FUTURE,
        usedAt: new Date(),
      },
    });
    const expired = await prisma.emailVerificationToken.create({
      data: { userId: teacher.userId, tokenHash: hashOpaqueToken(`expired-${Date.now()}`), expiresAt: PAST },
    });
    const fresh = await prisma.emailVerificationToken.create({
      data: { userId: teacher.userId, tokenHash: hashOpaqueToken(`fresh-${Date.now()}`), expiresAt: FUTURE },
    });

    await cleanupExpiredAuthRecords();

    expect(await prisma.emailVerificationToken.findUnique({ where: { id: used.id } })).toBeNull();
    expect(await prisma.emailVerificationToken.findUnique({ where: { id: expired.id } })).toBeNull();
    expect(await prisma.emailVerificationToken.findUnique({ where: { id: fresh.id } })).not.toBeNull();
  });

  it("deletes revoked and expired-pending invites, leaves a fresh pending and an accepted one alone", async () => {
    const teacher = await makeTeacher("cleanup-invites");
    const revoked = await prisma.studentInvite.create({
      data: {
        teacherId: teacher.teacherId,
        email: `revoked-${Date.now()}@example.com`,
        tokenHash: hashOpaqueToken(`revoked-${Date.now()}`),
        status: "revoked",
        expiresAt: FUTURE,
      },
    });
    const expiredPending = await prisma.studentInvite.create({
      data: {
        teacherId: teacher.teacherId,
        email: `expired-${Date.now()}@example.com`,
        tokenHash: hashOpaqueToken(`expired-${Date.now()}`),
        status: "pending",
        expiresAt: PAST,
      },
    });
    const freshPending = await prisma.studentInvite.create({
      data: {
        teacherId: teacher.teacherId,
        email: `fresh-${Date.now()}@example.com`,
        tokenHash: hashOpaqueToken(`fresh-${Date.now()}`),
        status: "pending",
        expiresAt: FUTURE,
      },
    });
    const accepted = await prisma.studentInvite.create({
      data: {
        teacherId: teacher.teacherId,
        email: `accepted-${Date.now()}@example.com`,
        tokenHash: hashOpaqueToken(`accepted-${Date.now()}`),
        status: "accepted",
        expiresAt: PAST, // even though its TTL has long passed, "accepted" must survive
        acceptedAt: new Date(),
      },
    });

    await cleanupExpiredAuthRecords();

    expect(await prisma.studentInvite.findUnique({ where: { id: revoked.id } })).toBeNull();
    expect(await prisma.studentInvite.findUnique({ where: { id: expiredPending.id } })).toBeNull();
    expect(await prisma.studentInvite.findUnique({ where: { id: freshPending.id } })).not.toBeNull();
    expect(await prisma.studentInvite.findUnique({ where: { id: accepted.id } })).not.toBeNull();
  });

  it("returns accurate counts of what it deleted", async () => {
    const teacher = await makeTeacher("cleanup-counts");
    await prisma.session.create({
      data: { userId: teacher.userId, tokenHash: hashOpaqueToken(`count-${Date.now()}`), expiresAt: PAST },
    });

    const summary = await cleanupExpiredAuthRecords();
    expect(summary.sessionsDeleted).toBeGreaterThanOrEqual(1);
    expect(typeof summary.passwordResetTokensDeleted).toBe("number");
    expect(typeof summary.emailVerificationTokensDeleted).toBe("number");
    expect(typeof summary.studentInvitesDeleted).toBe("number");
  });
});
