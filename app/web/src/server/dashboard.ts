import { withTenantContext } from "./tenant-context";
import { labelForLesson } from "./lesson-label";
import { startOfWeekUtc } from "../lib/calendar/view-range";

/**
 * Read-only aggregates for the teacher's main dashboard — deliberately just three numbers/
 * lists a teacher actually checks day-to-day (upcoming lessons, this week's income, who
 * still owes money), not a general reporting/analytics feature (that's Phase 5 per
 * docs/ROADMAP.md, exports and period-over-period reports need accumulated data to be
 * meaningful; this doesn't).
 */

export interface DashboardLesson {
  id: string;
  scheduledAt: Date;
  durationMinutes: number;
  priceCents: number;
  /** Either the student's display name/email, or "Группа: X" for a group lesson — same
   *  labeling convention as /teacher/schedule's table. */
  studentLabel: string;
  zoomLinkSnapshot: string | null;
}

export interface DashboardOverview {
  upcomingLessons: DashboardLesson[];
  weekIncomeCents: number;
  unpaidLessons: DashboardLesson[];
}

export async function getTeacherDashboardOverview(teacherId: string): Promise<DashboardOverview> {
  const now = new Date();
  // No per-teacher timezone arithmetic yet — nothing else in the app does date math against
  // TeacherProfile.timezone either, this doesn't introduce a new inconsistency.
  const weekStart = startOfWeekUtc(now);
  const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);

  const include = {
    studentLink: {
      select: { displayName: true, studentUser: { select: { email: true } } },
    },
    group: { select: { name: true } },
  } as const;

  return withTenantContext({ teacherId }, async (tx) => {
    const [upcoming, unpaid, weekIncome] = await Promise.all([
      tx.lesson.findMany({
        where: { teacherId, status: "scheduled", scheduledAt: { gte: now } },
        orderBy: { scheduledAt: "asc" },
        take: 10,
        include,
      }),
      // "Unpaid" means a lesson that actually happened but hasn't been paid for — a lesson
      // that's merely scheduled isn't expected to be paid yet, so it doesn't belong here.
      tx.lesson.findMany({
        where: { teacherId, status: "completed", paidAt: null },
        orderBy: { scheduledAt: "asc" },
        include,
      }),
      // "Income" = money actually marked paid this week (paidAt in range), not the value of
      // lessons merely scheduled this week — matches what a teacher means by "доходы", not
      // "занятий на эту неделю".
      tx.lesson.aggregate({
        where: { teacherId, paidAt: { gte: weekStart, lt: weekEnd } },
        _sum: { priceCents: true },
      }),
    ]);

    return {
      upcomingLessons: upcoming.map((l) => ({
        id: l.id,
        scheduledAt: l.scheduledAt,
        durationMinutes: l.durationMinutes,
        priceCents: l.priceCents,
        studentLabel: labelForLesson(l),
        zoomLinkSnapshot: l.zoomLinkSnapshot,
      })),
      weekIncomeCents: weekIncome._sum.priceCents ?? 0,
      unpaidLessons: unpaid.map((l) => ({
        id: l.id,
        scheduledAt: l.scheduledAt,
        durationMinutes: l.durationMinutes,
        priceCents: l.priceCents,
        studentLabel: labelForLesson(l),
        zoomLinkSnapshot: l.zoomLinkSnapshot,
      })),
    };
  });
}
