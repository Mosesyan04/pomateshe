import { describe, it, expect, afterAll } from "vitest";
import { registerTeacher } from "../teachers";
import { recordConsent } from "../consents";
import { cleanupTestData } from "./test-helpers";
import { prisma } from "../db";

const createdUserIds: string[] = [];

afterAll(async () => {
  await cleanupTestData(createdUserIds);
  await prisma.$disconnect();
});

async function makeTeacher(label: string) {
  const t = await registerTeacher({
    email: `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
    password: "correct horse battery staple",
    displayName: `${label} teacher`,
    slug: `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    timezone: "Europe/Moscow",
  });
  createdUserIds.push(t.userId);
  return t;
}

describe("recordConsent", () => {
  it("writes one ConsentRecord row per type, with the given policyVersion/ip/userAgent", async () => {
    const teacher = await makeTeacher("consent-basic");

    await recordConsent({
      userId: teacher.userId,
      types: ["offer", "privacy_policy", "pdn_processing"],
      policyVersion: "2026-09-10",
      ip: "203.0.113.5",
      userAgent: "vitest-agent",
    });

    const rows = await prisma.consentRecord.findMany({ where: { userId: teacher.userId } });
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((r) => r.type))).toEqual(new Set(["offer", "privacy_policy", "pdn_processing"]));
    for (const row of rows) {
      expect(row.policyVersion).toBe("2026-09-10");
      expect(row.ip).toBe("203.0.113.5");
      expect(row.userAgent).toBe("vitest-agent");
    }
  });

  it("a re-submission of the same consent (same userId/type/policyVersion) does not throw or duplicate", async () => {
    const teacher = await makeTeacher("consent-dup");

    await recordConsent({
      userId: teacher.userId,
      types: ["pdn_processing"],
      policyVersion: "2026-09-10",
      ip: "203.0.113.5",
      userAgent: "vitest-agent",
    });
    // Same event again — e.g. a double-submitted form. @@unique([userId, type, policyVersion])
    // means this must be silently skipped, not throw.
    await expect(
      recordConsent({
        userId: teacher.userId,
        types: ["pdn_processing"],
        policyVersion: "2026-09-10",
        ip: "203.0.113.5",
        userAgent: "vitest-agent",
      }),
    ).resolves.not.toThrow();

    const rows = await prisma.consentRecord.findMany({
      where: { userId: teacher.userId, type: "pdn_processing" },
    });
    expect(rows).toHaveLength(1);
  });

  it("a new policyVersion for the same type creates a separate row (old consent isn't silently reused)", async () => {
    const teacher = await makeTeacher("consent-version-bump");

    await recordConsent({
      userId: teacher.userId,
      types: ["privacy_policy"],
      policyVersion: "2026-09-10",
      ip: "203.0.113.5",
      userAgent: null,
    });
    await recordConsent({
      userId: teacher.userId,
      types: ["privacy_policy"],
      policyVersion: "2027-01-01",
      ip: "203.0.113.5",
      userAgent: null,
    });

    const rows = await prisma.consentRecord.findMany({
      where: { userId: teacher.userId, type: "privacy_policy" },
      orderBy: { policyVersion: "asc" },
    });
    expect(rows.map((r) => r.policyVersion)).toEqual(["2026-09-10", "2027-01-01"]);
  });
});
