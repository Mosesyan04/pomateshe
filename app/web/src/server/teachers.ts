import { createId } from "@paralleldrive/cuid2";
import { prisma } from "./db";
import { withTenantContext } from "./tenant-context";
import { hashPassword } from "../lib/auth/password";

export interface RegisterTeacherInput {
  email: string;
  password: string;
  displayName: string;
  slug: string;
  timezone: string;
}

export interface RegisteredTeacher {
  userId: string;
  teacherId: string;
}

/**
 * Registers a new teacher: User (not tenant-scoped) + TeacherProfile (tenant-scoped, keyed
 * on its own id — docs/MULTI_TENANCY.md §2.3, the RLS policy here is
 * `"id" = current_setting('app.current_teacher_id')`).
 *
 * The TeacherProfile id is generated here, in application code, BEFORE the insert — not via
 * Prisma's `@default(cuid(2))` — specifically so the tenant context can be set to that same
 * id inside the same transaction before the INSERT runs. Letting Postgres/Prisma generate
 * the id only after the row exists would mean there is no valid `app.current_teacher_id` to
 * set yet, and the FORCE ROW LEVEL SECURITY policy (which applies to INSERT via its USING
 * clause, since no separate WITH CHECK was given) would reject the insert.
 */
export async function registerTeacher(input: RegisterTeacherInput): Promise<RegisteredTeacher> {
  const passwordHash = await hashPassword(input.password);
  const teacherId = createId();

  const user = await prisma.user.create({
    data: {
      email: input.email,
      passwordHash,
      role: "teacher",
    },
  });

  await withTenantContext({ teacherId }, (tx) =>
    tx.teacherProfile.create({
      data: {
        id: teacherId,
        userId: user.id,
        slug: input.slug,
        displayName: input.displayName,
        timezone: input.timezone,
      },
    }),
  );

  // User carries no RLS (docs/DATABASE.md §2) — this plain update needs no tenant context,
  // and is what makes it possible to answer "given this userId, what's their teacherId?"
  // anywhere else in the app without re-querying the RLS-protected teacher_profiles table.
  // See the schema.prisma comment on User.teacherProfileId for the full "why".
  await prisma.user.update({
    where: { id: user.id },
    data: { teacherProfileId: teacherId },
  });

  return { userId: user.id, teacherId };
}

export interface CreateLessonInput {
  teacherId: string;
  groupId: string;
  scheduledAt: Date;
  durationMinutes: number;
  priceCents: number;
}

/**
 * Minimal example of a tenant-scoped data-access function — proves the withTenantContext
 * pattern end-to-end for the Phase 1 exit criterion (docs/ROADMAP.md: two teachers can
 * register independently and tests confirm no data crosses between them). Full lesson
 * business logic (student-vs-group target, pricing defaults, calendar sync) is Phase 2.
 */
export async function createLesson(input: CreateLessonInput) {
  return withTenantContext({ teacherId: input.teacherId }, (tx) =>
    tx.lesson.create({
      data: {
        teacherId: input.teacherId,
        groupId: input.groupId,
        scheduledAt: input.scheduledAt,
        durationMinutes: input.durationMinutes,
        priceCents: input.priceCents,
      },
    }),
  );
}

export async function getLessonsForTeacher(teacherId: string) {
  return withTenantContext({ teacherId }, (tx) =>
    tx.lesson.findMany({ where: { teacherId }, orderBy: { scheduledAt: "asc" } }),
  );
}

export async function createGroup(teacherId: string, name: string) {
  return withTenantContext({ teacherId }, (tx) =>
    tx.group.create({ data: { teacherId, name } }),
  );
}

export interface StudentFilters {
  /** Matches against displayName, contactPhone, contactTelegram (case-insensitive substring). */
  search?: string;
  subject?: string;
  gradeLevel?: string;
  priceMinCents?: number;
  priceMaxCents?: number;
  durationMinMinutes?: number;
  durationMaxMinutes?: number;
}

/**
 * `filters` is optional and defaults to none — existing call sites (schedule/homework pages)
 * that only need "my active students" keep working unchanged; only the students list page
 * passes filters.
 */
export async function getStudentsForTeacher(teacherId: string, filters: StudentFilters = {}) {
  const priceRange =
    filters.priceMinCents != null || filters.priceMaxCents != null
      ? { gte: filters.priceMinCents, lte: filters.priceMaxCents }
      : undefined;
  const durationRange =
    filters.durationMinMinutes != null || filters.durationMaxMinutes != null
      ? { gte: filters.durationMinMinutes, lte: filters.durationMaxMinutes }
      : undefined;

  return withTenantContext({ teacherId }, (tx) =>
    tx.teacherStudentLink.findMany({
      where: {
        teacherId,
        status: "active",
        ...(filters.subject ? { subject: filters.subject } : {}),
        ...(filters.gradeLevel ? { gradeLevel: filters.gradeLevel } : {}),
        ...(priceRange ? { defaultPriceCents: priceRange } : {}),
        ...(durationRange ? { defaultDurationMinutes: durationRange } : {}),
        ...(filters.search
          ? {
              OR: [
                { displayName: { contains: filters.search, mode: "insensitive" } },
                { contactPhone: { contains: filters.search, mode: "insensitive" } },
                { contactTelegram: { contains: filters.search, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      include: { studentUser: { select: { email: true } } },
      orderBy: { createdAt: "desc" },
    }),
  );
}

export async function getStudentLinkForTeacher(teacherId: string, studentLinkId: string) {
  return withTenantContext({ teacherId }, (tx) =>
    tx.teacherStudentLink.findFirst({
      where: { id: studentLinkId, teacherId },
      include: { studentUser: { select: { email: true } } },
    }),
  );
}

export interface UpdateStudentLinkInput {
  teacherId: string;
  studentLinkId: string;
  displayName?: string;
  subject?: string;
  gradeLevel?: string;
  contactPhone?: string;
  contactTelegram?: string;
  defaultPriceCents?: number;
  defaultDurationMinutes?: number;
  notes?: string;
}

/** updateMany + throw-on-zero — same tampering guard as lessons.ts's updateLessonStatus. */
export async function updateStudentLink(input: UpdateStudentLinkInput): Promise<void> {
  return withTenantContext({ teacherId: input.teacherId }, async (tx) => {
    const result = await tx.teacherStudentLink.updateMany({
      where: { id: input.studentLinkId, teacherId: input.teacherId },
      data: {
        displayName: input.displayName,
        subject: input.subject,
        gradeLevel: input.gradeLevel,
        contactPhone: input.contactPhone,
        contactTelegram: input.contactTelegram,
        defaultPriceCents: input.defaultPriceCents,
        defaultDurationMinutes: input.defaultDurationMinutes,
        notes: input.notes,
      },
    });
    if (result.count === 0) {
      throw new Error("Ученик не найден.");
    }
  });
}
