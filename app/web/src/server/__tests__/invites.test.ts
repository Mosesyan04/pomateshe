import { describe, it, expect, afterAll } from "vitest";
import { registerTeacher, getStudentsForTeacher } from "../teachers";
import {
  createInvite,
  lookupInvite,
  acceptInviteAsNewUser,
  acceptInviteForExistingUser,
  revokeInvite,
  listInvitesForTeacher,
} from "../invites";
import { cleanupTestData } from "./test-helpers";
import { prisma } from "../db";

/**
 * docs/AUTH.md §3 — both branches of invite acceptance, plus the isolation-relevant case:
 * a student already linked to teacher A can be invited by teacher B and ends up linked to
 * both, without creating a second User row (docs/MULTI_TENANCY.md §1.1's whole reason for
 * being — a student is not locked to one teacher).
 */

const createdUserIds: string[] = [];

afterAll(async () => {
  await cleanupTestData(createdUserIds);
  await prisma.$disconnect();
});

describe("Student invites", () => {
  it("new-user branch: creates exactly one User and one active TeacherStudentLink", async () => {
    const teacher = await registerTeacher({
      email: `inv-teacher-a-${Date.now()}@example.com`,
      password: "correct horse battery staple G",
      displayName: "Invite Teacher A",
      slug: `inv-teacher-a-${Date.now()}`,
      timezone: "Europe/Moscow",
    });
    createdUserIds.push(teacher.userId);

    const studentEmail = `new-student-${Date.now()}@example.com`;
    const invite = await createInvite(teacher.teacherId, studentEmail);

    const lookupBefore = await lookupInvite(invite.token);
    expect(lookupBefore).toMatchObject({ valid: true, email: studentEmail, existingAccount: false });

    const { session } = await acceptInviteAsNewUser(invite.token, "a brand new password");
    expect(session.token).toBeTruthy();

    const newUser = await prisma.user.findUnique({ where: { email: studentEmail } });
    expect(newUser).not.toBeNull();
    createdUserIds.push(newUser!.id);

    const students = await getStudentsForTeacher(teacher.teacherId);
    expect(students).toHaveLength(1);
    expect(students[0].studentUserId).toBe(newUser!.id);

    // Token is single-use — a second accept attempt must fail, not silently create a duplicate.
    await expect(acceptInviteAsNewUser(invite.token, "another password")).rejects.toThrow();

    const lookupAfter = await lookupInvite(invite.token);
    expect(lookupAfter).toMatchObject({ valid: false, reason: "already_used" });
  });

  it("existing-user branch: a student already linked to one teacher can accept an invite from a second teacher without creating a duplicate User", async () => {
    const teacherA = await registerTeacher({
      email: `inv-teacher-b1-${Date.now()}@example.com`,
      password: "correct horse battery staple H",
      displayName: "Invite Teacher B1",
      slug: `inv-teacher-b1-${Date.now()}`,
      timezone: "Europe/Moscow",
    });
    const teacherB = await registerTeacher({
      email: `inv-teacher-b2-${Date.now()}@example.com`,
      password: "correct horse battery staple I",
      displayName: "Invite Teacher B2",
      slug: `inv-teacher-b2-${Date.now()}`,
      timezone: "Europe/Moscow",
    });
    createdUserIds.push(teacherA.userId, teacherB.userId);

    const studentEmail = `multi-teacher-student-${Date.now()}@example.com`;
    const inviteFromA = await createInvite(teacherA.teacherId, studentEmail);
    const { session: firstSession } = await acceptInviteAsNewUser(inviteFromA.token, "first password 123");

    const studentUser = await prisma.user.findUnique({ where: { email: studentEmail } });
    createdUserIds.push(studentUser!.id);
    expect(firstSession.token).toBeTruthy();

    // Second teacher invites the SAME email — this must link the existing user, not create
    // a second User row (the exact scenario docs/MULTI_TENANCY.md §1.1 exists to support).
    const inviteFromB = await createInvite(teacherB.teacherId, studentEmail);
    const lookupB = await lookupInvite(inviteFromB.token);
    expect(lookupB).toMatchObject({ valid: true, existingAccount: true });

    await acceptInviteForExistingUser(inviteFromB.token, studentUser!.id);

    const allUsersWithEmail = await prisma.user.findMany({ where: { email: studentEmail } });
    expect(allUsersWithEmail).toHaveLength(1); // no duplicate account was created

    const studentsOfA = await getStudentsForTeacher(teacherA.teacherId);
    const studentsOfB = await getStudentsForTeacher(teacherB.teacherId);
    expect(studentsOfA.map((s) => s.studentUserId)).toContain(studentUser!.id);
    expect(studentsOfB.map((s) => s.studentUserId)).toContain(studentUser!.id);
  });

  it("rejects linking an existing account to an invite sent to a different email", async () => {
    const teacher = await registerTeacher({
      email: `inv-teacher-c-${Date.now()}@example.com`,
      password: "correct horse battery staple J",
      displayName: "Invite Teacher C",
      slug: `inv-teacher-c-${Date.now()}`,
      timezone: "Europe/Moscow",
    });
    createdUserIds.push(teacher.userId);

    const inviteEmail = `invited-${Date.now()}@example.com`;
    const invite = await createInvite(teacher.teacherId, inviteEmail);

    // A completely unrelated already-registered user tries to accept someone else's invite.
    const unrelatedTeacher = await registerTeacher({
      email: `unrelated-${Date.now()}@example.com`,
      password: "correct horse battery staple K",
      displayName: "Unrelated",
      slug: `unrelated-${Date.now()}`,
      timezone: "Europe/Moscow",
    });
    createdUserIds.push(unrelatedTeacher.userId);

    await expect(
      acceptInviteForExistingUser(invite.token, unrelatedTeacher.userId),
    ).rejects.toThrow(/different email/);
  });

  it("a revoked invite cannot be accepted", async () => {
    const teacher = await registerTeacher({
      email: `inv-teacher-d-${Date.now()}@example.com`,
      password: "correct horse battery staple L",
      displayName: "Invite Teacher D",
      slug: `inv-teacher-d-${Date.now()}`,
      timezone: "Europe/Moscow",
    });
    createdUserIds.push(teacher.userId);

    const invite = await createInvite(teacher.teacherId, `revoke-me-${Date.now()}@example.com`);
    await revokeInvite(teacher.teacherId, invite.id);

    const lookup = await lookupInvite(invite.token);
    expect(lookup).toMatchObject({ valid: false, reason: "already_used" });
    await expect(acceptInviteAsNewUser(invite.token, "irrelevant password")).rejects.toThrow();
  });

  it("a teacher cannot revoke another teacher's invite", async () => {
    const teacherA = await registerTeacher({
      email: `inv-teacher-e1-${Date.now()}@example.com`,
      password: "correct horse battery staple M",
      displayName: "Invite Teacher E1",
      slug: `inv-teacher-e1-${Date.now()}`,
      timezone: "Europe/Moscow",
    });
    const teacherB = await registerTeacher({
      email: `inv-teacher-e2-${Date.now()}@example.com`,
      password: "correct horse battery staple N",
      displayName: "Invite Teacher E2",
      slug: `inv-teacher-e2-${Date.now()}`,
      timezone: "Europe/Moscow",
    });
    createdUserIds.push(teacherA.userId, teacherB.userId);

    const invite = await createInvite(teacherA.teacherId, `cross-teacher-${Date.now()}@example.com`);

    // teacherB tries to revoke teacherA's invite by id — must be a no-op, not succeed.
    await revokeInvite(teacherB.teacherId, invite.id);

    const stillPending = await listInvitesForTeacher(teacherA.teacherId);
    expect(stillPending.find((i) => i.id === invite.id)?.status).toBe("pending");
  });
});
