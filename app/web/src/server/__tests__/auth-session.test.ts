import { describe, it, expect, afterAll } from "vitest";
import { registerTeacher } from "../teachers";
import { createSession, validateSession } from "../../lib/auth/session";
import { cleanupTestData } from "./test-helpers";
import { prisma } from "../db";

/**
 * Regression test for a real Phase 1 bug, not a hypothetical one: getCurrentUser() used to
 * query `teacherProfile.findUnique({ where: { userId } })` directly to find a logged-in
 * teacher's teacherId. teacher_profiles has RLS keyed on its own id (docs/MULTI_TENANCY.md
 * §2.3) — with no tenant context set yet (finding the context WAS the query), that lookup
 * silently returned zero rows on every single request, which meant every teacher was bounced
 * to /login immediately after successfully registering or logging in. Caught by a Playwright
 * smoke test against a real running server, not by any automated test at the time — this
 * test exists so it can never regress silently again. See the User.teacherProfileId comment
 * in schema.prisma for the actual fix.
 */

const createdUserIds: string[] = [];

afterAll(async () => {
  await cleanupTestData(createdUserIds);
  await prisma.$disconnect();
});

describe("Session validation surfaces a teacher's teacherId without querying RLS-protected teacher_profiles directly", () => {
  it("validateSession returns the correct teacherProfileId right after registration", async () => {
    const teacher = await registerTeacher({
      email: `session-teacher-${Date.now()}@example.com`,
      password: "correct horse battery staple O",
      displayName: "Session Test Teacher",
      slug: `session-teacher-${Date.now()}`,
      timezone: "Europe/Moscow",
    });
    createdUserIds.push(teacher.userId);

    const session = await createSession(teacher.userId);
    const validated = await validateSession(session.token);

    expect(validated).not.toBeNull();
    expect(validated!.role).toBe("teacher");
    // This is the exact assertion that would have caught the bug: teacherProfileId must be
    // the real profile id, not null/undefined.
    expect(validated!.teacherProfileId).toBe(teacher.teacherId);
  });

  it("a student session has no teacherProfileId", async () => {
    const teacher = await registerTeacher({
      email: `session-teacher-b-${Date.now()}@example.com`,
      password: "correct horse battery staple P",
      displayName: "Session Test Teacher B",
      slug: `session-teacher-b-${Date.now()}`,
      timezone: "Europe/Moscow",
    });
    createdUserIds.push(teacher.userId);

    const { acceptInviteAsNewUser, createInvite } = await import("../invites");
    const invite = await createInvite(teacher.teacherId, `session-student-${Date.now()}@example.com`);
    const { session } = await acceptInviteAsNewUser(invite.token, "student session password 789");
    createdUserIds.push((await validateSession(session.token))!.userId);

    const validated = await validateSession(session.token);
    expect(validated!.role).toBe("student");
    expect(validated!.teacherProfileId).toBeNull();
  });
});
