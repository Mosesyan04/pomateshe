import { withTenantContext } from "./tenant-context";

/**
 * Private calendar blocks — "занят", "другая работа", personal sections — for either role.
 * See docs/MULTI_TENANCY.md §4.4: not tenant data, owned by exactly one User, invisible to
 * everyone else including a linked teacher/student on the other side of the relationship.
 */

export interface PersonalEvent {
  id: string;
  title: string;
  scheduledAt: Date;
  durationMinutes: number;
  notes: string | null;
}

export interface CreatePersonalEventInput {
  ownerUserId: string;
  title: string;
  scheduledAt: Date;
  durationMinutes: number;
  notes?: string;
}

export async function createPersonalEvent(input: CreatePersonalEventInput): Promise<PersonalEvent> {
  return withTenantContext({ userId: input.ownerUserId }, (tx) =>
    tx.personalCalendarEvent.create({
      data: {
        ownerUserId: input.ownerUserId,
        title: input.title,
        scheduledAt: input.scheduledAt,
        durationMinutes: input.durationMinutes,
        notes: input.notes,
      },
    }),
  );
}

export async function getPersonalEventsForUser(
  ownerUserId: string,
  range: { from: Date; toExclusive: Date },
): Promise<PersonalEvent[]> {
  return withTenantContext({ userId: ownerUserId }, (tx) =>
    tx.personalCalendarEvent.findMany({
      where: { ownerUserId, scheduledAt: { gte: range.from, lt: range.toExclusive } },
      orderBy: { scheduledAt: "asc" },
    }),
  );
}

/** updateMany + throw-on-zero — same tampering guard as lessons.ts/groups.ts. RLS already
 *  makes another user's event invisible in this context, so a mismatched id can only mean a
 *  tampered request, which should fail loudly, not silently no-op. */
export async function reschedulePersonalEvent(
  ownerUserId: string,
  eventId: string,
  newScheduledAt: Date,
  newDurationMinutes?: number,
): Promise<void> {
  return withTenantContext({ userId: ownerUserId }, async (tx) => {
    const result = await tx.personalCalendarEvent.updateMany({
      where: { id: eventId, ownerUserId },
      data: {
        scheduledAt: newScheduledAt,
        ...(newDurationMinutes != null ? { durationMinutes: newDurationMinutes } : {}),
      },
    });
    if (result.count === 0) {
      throw new Error("Событие не найдено.");
    }
  });
}

export async function deletePersonalEvent(ownerUserId: string, eventId: string): Promise<void> {
  return withTenantContext({ userId: ownerUserId }, async (tx) => {
    const result = await tx.personalCalendarEvent.deleteMany({ where: { id: eventId, ownerUserId } });
    if (result.count === 0) {
      throw new Error("Событие не найдено.");
    }
  });
}
