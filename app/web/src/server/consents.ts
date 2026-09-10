import { prisma } from "./db";
import type { ConsentType } from "../../generated/prisma/client";

/**
 * ConsentRecord is not tenant-scoped (docs/CONSENTS.md §2, schema.prisma model comment) — a
 * plain prisma call, same as Session/StudentInvite, no withTenantContext needed.
 */

export interface RecordConsentInput {
  userId: string;
  types: ConsentType[];
  policyVersion: string;
  ip: string;
  userAgent: string | null;
}

export async function recordConsent(input: RecordConsentInput): Promise<void> {
  await prisma.consentRecord.createMany({
    // One row per type, all sharing the same policyVersion/ip/userAgent — they were all given
    // in the same form submission (docs/CONSENTS.md §2's table lists them as separate types,
    // not separate events, when requested together at registration).
    data: input.types.map((type) => ({
      userId: input.userId,
      type,
      policyVersion: input.policyVersion,
      ip: input.ip,
      userAgent: input.userAgent ?? undefined,
    })),
    // @@unique([userId, type, policyVersion]) — a re-submission of the same form (e.g. a
    // double-click) must not throw, it's not a new consent event.
    skipDuplicates: true,
  });
}
