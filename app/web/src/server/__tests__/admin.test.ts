import { describe, it, expect, afterAll } from "vitest";
import { registerTeacher } from "../teachers";
import { createOrPromoteAdmin } from "../admin";
import { createSession, validateSession } from "../../lib/auth/session";
import { verifyPassword } from "../../lib/auth/password";
import { cleanupTestData } from "./test-helpers";
import { prisma } from "../db";

const createdUserIds: string[] = [];

afterAll(async () => {
  await cleanupTestData(createdUserIds);
  await prisma.$disconnect();
});

function uniqueEmail(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
}

describe("createOrPromoteAdmin", () => {
  it("creates a brand-new admin account when the email doesn't exist yet", async () => {
    const email = uniqueEmail("admin-new");
    const result = await createOrPromoteAdmin(email, "a strong admin password 1");
    createdUserIds.push(result.userId);

    expect(result.action).toBe("created");
    const user = await prisma.user.findUniqueOrThrow({ where: { id: result.userId } });
    expect(user.role).toBe("admin");
    expect(await verifyPassword(user.passwordHash, "a strong admin password 1")).toBe(true);
  });

  it("lowercases and trims the email", async () => {
    const email = uniqueEmail("admin-case");
    const result = await createOrPromoteAdmin(`  ${email.toUpperCase()}  `, "a strong admin password 2");
    createdUserIds.push(result.userId);

    expect(result.email).toBe(email);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: result.userId } });
    expect(user.email).toBe(email);
  });

  it("promotes an existing teacher to admin, and revokes their existing sessions", async () => {
    const teacher = await registerTeacher({
      email: uniqueEmail("admin-promote"),
      password: "correct horse battery staple",
      displayName: "To-Be-Promoted Teacher",
      slug: `admin-promote-${Date.now()}`,
      timezone: "Europe/Moscow",
    });
    createdUserIds.push(teacher.userId);

    const session = await createSession(teacher.userId);
    expect(await validateSession(session.token)).not.toBeNull();

    const user = await prisma.user.findUniqueOrThrow({ where: { id: teacher.userId } });
    const result = await createOrPromoteAdmin(user.email, "irrelevant, existing user keeps their own password");

    expect(result).toEqual({ userId: teacher.userId, email: user.email, action: "promoted" });
    const promoted = await prisma.user.findUniqueOrThrow({ where: { id: teacher.userId } });
    expect(promoted.role).toBe("admin");
    // The teacher's original password must be untouched by a promotion.
    expect(promoted.passwordHash).toBe(user.passwordHash);
    // And their pre-existing session must no longer validate.
    expect(await validateSession(session.token)).toBeNull();
  });

  it("is a no-op (but still reports success) when the user is already an admin", async () => {
    const email = uniqueEmail("admin-idempotent");
    const first = await createOrPromoteAdmin(email, "a strong admin password 3");
    createdUserIds.push(first.userId);

    const second = await createOrPromoteAdmin(email, "a different password entirely");
    expect(second).toEqual({ userId: first.userId, email, action: "already_admin" });

    // The second call must not have touched the password from the first call.
    const user = await prisma.user.findUniqueOrThrow({ where: { id: first.userId } });
    expect(await verifyPassword(user.passwordHash, "a strong admin password 3")).toBe(true);
  });
});
