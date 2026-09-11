import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerTeacher } from "../teachers";
import { createInvite, acceptInviteAsNewUser } from "../invites";
import { getStudentsForTeacher } from "../teachers";
import { withTenantContext } from "../tenant-context";
import { cleanupExpiredWhiteboards } from "../whiteboard-retention";
import { cleanupTestData } from "./test-helpers";
import { prisma } from "../db";

const createdUserIds: string[] = [];

afterAll(async () => {
  await cleanupTestData(createdUserIds);
  await prisma.$disconnect();
});

async function makeTeacherWithStudent(label: string) {
  const t = await registerTeacher({
    email: `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
    password: "correct horse battery staple",
    displayName: `${label} teacher`,
    slug: `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    timezone: "Europe/Moscow",
  });
  createdUserIds.push(t.userId);

  const invite = await createInvite(t.teacherId, `${label}-student-${Date.now()}@example.com`);
  const { session } = await acceptInviteAsNewUser(invite.token, "student password 123456");
  const students = await getStudentsForTeacher(t.teacherId);
  const link = students.find((s) => s.status === "active")!;
  createdUserIds.push(link.studentUserId);
  void session; // not needed further — just proving the invite accept succeeded

  return { teacherId: t.teacherId, studentLinkId: link.id };
}

const PAST = new Date(Date.now() - 60_000);
const FUTURE = new Date(Date.now() + 60 * 60_000);

async function createWhiteboard(teacherId: string, studentLinkId: string, expiresAt: Date) {
  return withTenantContext({ teacherId }, (tx) =>
    tx.whiteboard.create({ data: { teacherId, studentLinkId, expiresAt } }),
  );
}

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "wb-retention-test-"));
  process.env.WHITEBOARD_SNAPSHOT_DIR = tmpDir;
});

afterEach(async () => {
  delete process.env.WHITEBOARD_SNAPSHOT_DIR;
  await rm(tmpDir, { recursive: true, force: true });
});

function snapshotPathFor(teacherId: string, whiteboardId: string): string {
  return join(tmpDir, "teachers", teacherId, "whiteboards", whiteboardId, "snapshot.bin");
}

describe("cleanupExpiredWhiteboards", () => {
  it("deletes an expired whiteboard's DB row and leaves an active one (different teacher) untouched", async () => {
    // Two separate teacher/student pairs — (teacherId, studentLinkId) is unique per board, so
    // "expired" and "active" need distinct keys, not just distinct expiresAt values.
    const expiredFixture = await makeTeacherWithStudent("wbret-basic-expired");
    const activeFixture = await makeTeacherWithStudent("wbret-basic-active");
    const expired = await createWhiteboard(expiredFixture.teacherId, expiredFixture.studentLinkId, PAST);
    const active = await createWhiteboard(activeFixture.teacherId, activeFixture.studentLinkId, FUTURE);

    await cleanupExpiredWhiteboards();

    const expiredSurvivors = await withTenantContext({ teacherId: expiredFixture.teacherId }, (tx) =>
      tx.whiteboard.findMany({ where: { id: expired.id } }),
    );
    const activeSurvivors = await withTenantContext({ teacherId: activeFixture.teacherId }, (tx) =>
      tx.whiteboard.findMany({ where: { id: active.id } }),
    );
    expect(expiredSurvivors).toHaveLength(0);
    expect(activeSurvivors).toHaveLength(1);
  });

  it("deletes the whiteboard's snapshot object from storage along with its DB row", async () => {
    const { teacherId, studentLinkId } = await makeTeacherWithStudent("wbret-storage");
    const expired = await createWhiteboard(teacherId, studentLinkId, PAST);

    const path = snapshotPathFor(teacherId, expired.id);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, new Uint8Array([1, 2, 3]));

    await cleanupExpiredWhiteboards();

    await expect(readFile(path)).rejects.toThrow();
  });

  it("leaves an active whiteboard's snapshot object alone", async () => {
    const { teacherId, studentLinkId } = await makeTeacherWithStudent("wbret-storage-active");
    const active = await createWhiteboard(teacherId, studentLinkId, FUTURE);

    const path = snapshotPathFor(teacherId, active.id);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, new Uint8Array([9]));

    await cleanupExpiredWhiteboards();

    expect(await readFile(path)).toEqual(Buffer.from([9]));
  });

  it("spans multiple teachers in one run — the whole point of the retention_sweep policy", async () => {
    const teacherA = await makeTeacherWithStudent("wbret-cross-a");
    const teacherB = await makeTeacherWithStudent("wbret-cross-b");
    const expiredA = await createWhiteboard(teacherA.teacherId, teacherA.studentLinkId, PAST);
    const expiredB = await createWhiteboard(teacherB.teacherId, teacherB.studentLinkId, PAST);

    const summary = await cleanupExpiredWhiteboards();
    expect(summary.deleted).toBeGreaterThanOrEqual(2);

    const survivorsA = await withTenantContext({ teacherId: teacherA.teacherId }, (tx) =>
      tx.whiteboard.findMany({ where: { id: expiredA.id } }),
    );
    const survivorsB = await withTenantContext({ teacherId: teacherB.teacherId }, (tx) =>
      tx.whiteboard.findMany({ where: { id: expiredB.id } }),
    );
    expect(survivorsA).toHaveLength(0);
    expect(survivorsB).toHaveLength(0);
  });

  it("a plain unscoped query never sees an active whiteboard belonging to another teacher (RLS still holds)", async () => {
    const { teacherId, studentLinkId } = await makeTeacherWithStudent("wbret-isolation");
    const active = await createWhiteboard(teacherId, studentLinkId, FUTURE);

    // No withTenantContext at all — same access shape cleanupExpiredWhiteboards itself uses.
    // Only retention_sweep_select's predicate (expiresAt < now()) applies here; an active
    // board must be invisible through this path.
    const visible = await prisma.whiteboard.findMany({ where: { id: active.id } });
    expect(visible).toHaveLength(0);
  });
});
