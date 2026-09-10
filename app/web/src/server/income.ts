import { withTenantContext } from "./tenant-context";
import { labelForLesson } from "./lesson-label";
import type { LessonStatus } from "../../generated/prisma/client";

/**
 * Full payment record for a period — /teacher/income. Unlike dashboard.ts's week-income
 * figure (a single at-a-glance number), this is meant to answer "show me everything" for a
 * range the teacher picks, so it always returns the individual records alongside the totals —
 * nothing here is only visible through the chart (docs/CONSENTS.md-style "tooltip enhances,
 * never gates" principle, applied to the chart specifically, per the dataviz skill).
 */

export interface IncomeRecord {
  id: string;
  scheduledAt: Date;
  studentLabel: string;
  priceCents: number;
  paidAt: Date | null;
  status: LessonStatus;
}

export interface IncomeChartPoint {
  /** YYYY-MM-DD, UTC. */
  date: string;
  paidCents: number;
}

export interface IncomeOverview {
  records: IncomeRecord[];
  scheduledCents: number;
  paidCents: number;
  unpaidCents: number;
  /** One point per calendar day in [from, to) — including zero-income days, so the chart's
   *  x-axis is a continuous timeline, not just the days something happened to be paid. */
  chart: IncomeChartPoint[];
}

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * `from` inclusive, `to` EXCLUSIVE — the caller (the Server Component reading the date-range
 * form) is responsible for turning a human "to" date into the day after it, same convention
 * dashboard.ts's week boundary already uses.
 */
export async function getIncomeOverview(
  teacherId: string,
  from: Date,
  to: Date,
): Promise<IncomeOverview> {
  return withTenantContext({ teacherId }, async (tx) => {
    const lessons = await tx.lesson.findMany({
      where: { teacherId, scheduledAt: { gte: from, lt: to } },
      orderBy: { scheduledAt: "desc" },
      include: {
        studentLink: {
          select: { displayName: true, studentUser: { select: { email: true } } },
        },
        group: { select: { name: true } },
      },
    });

    const records: IncomeRecord[] = lessons.map((l) => ({
      id: l.id,
      scheduledAt: l.scheduledAt,
      studentLabel: labelForLesson(l),
      priceCents: l.priceCents,
      paidAt: l.paidAt,
      status: l.status,
    }));

    let scheduledCents = 0;
    let paidCents = 0;
    let unpaidCents = 0;
    const paidByDay = new Map<string, number>();

    for (const r of records) {
      scheduledCents += r.priceCents;
      if (r.paidAt) {
        paidCents += r.priceCents;
        const key = dayKey(r.scheduledAt);
        paidByDay.set(key, (paidByDay.get(key) ?? 0) + r.priceCents);
      } else {
        unpaidCents += r.priceCents;
      }
    }

    const chart: IncomeChartPoint[] = [];
    for (const cursor = new Date(from); cursor < to; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
      const key = dayKey(cursor);
      chart.push({ date: key, paidCents: paidByDay.get(key) ?? 0 });
    }

    return { records, scheduledCents, paidCents, unpaidCents, chart };
  });
}
