import { describe, it, expect, afterAll } from "vitest";
import { registerTeacher, createGroup, createLesson, getLessonsForTeacher } from "../teachers";
import { withTenantContext } from "../tenant-context";
import { cleanupTestData } from "./test-helpers";
import { prisma } from "../db";

/**
 * docs/MULTI_TENANCY.md §6.5 / docs/TESTING.md §2 point 5 — "Concurrency test".
 *
 * Catches the bug class where tenant context is set with plain SET (session-scoped) instead
 * of SET LOCAL inside a transaction, or set outside a $transaction entirely — such a bug
 * would only show up under concurrent access to a shared connection pool, never in a single
 * sequential test. Fires many interleaved withTenantContext calls for two different teachers
 * at once and asserts every single result set only ever contains that call's own teacher's
 * data — never the other teacher's, and never empty when it shouldn't be.
 */

const createdUserIds: string[] = [];

afterAll(async () => {
  await cleanupTestData(createdUserIds);
  await prisma.$disconnect();
});

describe("Concurrent requests do not leak tenant context across the connection pool", () => {
  it("interleaved reads for two teachers never cross-contaminate", async () => {
    const teacherA = await registerTeacher({
      email: `teacher-conc-a-${Date.now()}@example.com`,
      password: "correct horse battery staple E",
      displayName: "Teacher Conc A",
      slug: `teacher-conc-a-${Date.now()}`,
      timezone: "Europe/Moscow",
    });
    const teacherB = await registerTeacher({
      email: `teacher-conc-b-${Date.now()}@example.com`,
      password: "correct horse battery staple F",
      displayName: "Teacher Conc B",
      slug: `teacher-conc-b-${Date.now()}`,
      timezone: "Europe/Moscow",
    });
    createdUserIds.push(teacherA.userId, teacherB.userId);

    const groupA = await createGroup(teacherA.teacherId, "Conc Group A");
    const groupB = await createGroup(teacherB.teacherId, "Conc Group B");

    for (let i = 0; i < 5; i++) {
      await createLesson({
        teacherId: teacherA.teacherId,
        groupId: groupA.id,
        scheduledAt: new Date(),
        durationMinutes: 60,
        priceCents: 100000 + i,
      });
      await createLesson({
        teacherId: teacherB.teacherId,
        groupId: groupB.id,
        scheduledAt: new Date(),
        durationMinutes: 45,
        priceCents: 200000 + i,
      });
    }

    // Fire 40 interleaved reads (20 per teacher) concurrently — Promise.all deliberately
    // does not await sequentially, so these genuinely race for pooled connections.
    const calls: Array<Promise<{ teacherId: string; ok: boolean }>> = [];
    for (let i = 0; i < 20; i++) {
      calls.push(
        withTenantContext({ teacherId: teacherA.teacherId }, async (tx) => {
          const rows = await tx.lesson.findMany({ where: { teacherId: teacherA.teacherId } });
          return {
            teacherId: teacherA.teacherId,
            ok: rows.length === 5 && rows.every((r) => r.teacherId === teacherA.teacherId),
          };
        }),
      );
      calls.push(
        withTenantContext({ teacherId: teacherB.teacherId }, async (tx) => {
          const rows = await tx.lesson.findMany({ where: { teacherId: teacherB.teacherId } });
          return {
            teacherId: teacherB.teacherId,
            ok: rows.length === 5 && rows.every((r) => r.teacherId === teacherB.teacherId),
          };
        }),
      );
    }

    const results = await Promise.all(calls);
    for (const result of results) {
      expect(result.ok, `call scoped to ${result.teacherId} saw wrong/leaked data`).toBe(true);
    }

    // Belt-and-braces: also confirm via the public data-access function, not just the raw
    // transaction callback above.
    const finalA = await getLessonsForTeacher(teacherA.teacherId);
    const finalB = await getLessonsForTeacher(teacherB.teacherId);
    expect(finalA).toHaveLength(5);
    expect(finalB).toHaveLength(5);
    expect(finalA.every((l) => l.teacherId === teacherA.teacherId)).toBe(true);
    expect(finalB.every((l) => l.teacherId === teacherB.teacherId)).toBe(true);
  });
});
