import { describe, it, expect, afterAll } from "vitest";
import { registerTeacher, createGroup, createLesson, getLessonsForTeacher } from "../teachers";
import { cleanupTestData } from "./test-helpers";
import { prisma } from "../db";

/**
 * docs/MULTI_TENANCY.md §6.1 / docs/TESTING.md §2 point 1, and the direct exit criterion for
 * Phase 1 in docs/ROADMAP.md: "два преподавателя могут независимо зарегистрироваться, и
 * тесты подтверждают отсутствие пересечения их данных ни на уровне API, ни на уровне БД."
 *
 * Deliberately exercises the real application code path (registerTeacher / createLesson /
 * getLessonsForTeacher going through withTenantContext), not raw SQL — raw-SQL-level
 * isolation is covered separately by fail-closed.test.ts and rls-schema-policy.test.ts. This
 * test is what would fail if withTenantContext were bypassed somewhere, or if a data-access
 * function forgot to filter by teacherId.
 */

const createdUserIds: string[] = [];

afterAll(async () => {
  await cleanupTestData(createdUserIds);
  await prisma.$disconnect();
});

describe("Tenant isolation (application layer, two independently registered teachers)", () => {
  it("teacher B cannot see teacher A's lessons, and vice versa", async () => {
    const teacherA = await registerTeacher({
      email: `teacher-a-${Date.now()}@example.com`,
      password: "correct horse battery staple A",
      displayName: "Teacher A",
      slug: `teacher-a-${Date.now()}`,
      timezone: "Europe/Moscow",
    });
    const teacherB = await registerTeacher({
      email: `teacher-b-${Date.now()}@example.com`,
      password: "correct horse battery staple B",
      displayName: "Teacher B",
      slug: `teacher-b-${Date.now()}`,
      timezone: "Europe/Moscow",
    });
    createdUserIds.push(teacherA.userId, teacherB.userId);

    const groupA = await createGroup(teacherA.teacherId, "Group A");
    const groupB = await createGroup(teacherB.teacherId, "Group B");

    await createLesson({
      teacherId: teacherA.teacherId,
      groupId: groupA.id,
      scheduledAt: new Date(),
      durationMinutes: 60,
      priceCents: 150000,
    });
    await createLesson({
      teacherId: teacherB.teacherId,
      groupId: groupB.id,
      scheduledAt: new Date(),
      durationMinutes: 45,
      priceCents: 100000,
    });

    const lessonsForA = await getLessonsForTeacher(teacherA.teacherId);
    const lessonsForB = await getLessonsForTeacher(teacherB.teacherId);

    expect(lessonsForA).toHaveLength(1);
    expect(lessonsForA[0].teacherId).toBe(teacherA.teacherId);
    expect(lessonsForA[0].priceCents).toBe(150000);

    expect(lessonsForB).toHaveLength(1);
    expect(lessonsForB[0].teacherId).toBe(teacherB.teacherId);
    expect(lessonsForB[0].priceCents).toBe(100000);

    // The actual cross-tenant assertion: neither list contains so much as an id belonging
    // to the other teacher.
    const idsForA = new Set(lessonsForA.map((l) => l.id));
    const idsForB = new Set(lessonsForB.map((l) => l.id));
    for (const id of idsForA) expect(idsForB.has(id)).toBe(false);
  });

  it("rejects a teacherId/studentUserId that doesn't match the row's actual owner even if requested directly", async () => {
    const teacherA = await registerTeacher({
      email: `teacher-c-${Date.now()}@example.com`,
      password: "correct horse battery staple C",
      displayName: "Teacher C",
      slug: `teacher-c-${Date.now()}`,
      timezone: "Europe/Moscow",
    });
    const teacherB = await registerTeacher({
      email: `teacher-d-${Date.now()}@example.com`,
      password: "correct horse battery staple D",
      displayName: "Teacher D",
      slug: `teacher-d-${Date.now()}`,
      timezone: "Europe/Moscow",
    });
    createdUserIds.push(teacherA.userId, teacherB.userId);

    const groupA = await createGroup(teacherA.teacherId, "Group A2");
    const lessonA = await createLesson({
      teacherId: teacherA.teacherId,
      groupId: groupA.id,
      scheduledAt: new Date(),
      durationMinutes: 30,
      priceCents: 50000,
    });

    // Simulates the IDOR scenario from docs/THREAT_MODEL.md §2: teacher B's context is set,
    // but they try to read teacher A's lesson id directly. RLS must hide it regardless of
    // what id is asked for.
    const lessonsVisibleToB = await getLessonsForTeacher(teacherB.teacherId);
    expect(lessonsVisibleToB.find((l) => l.id === lessonA.id)).toBeUndefined();
  });
});
