"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { registerTeacher } from "../../server/teachers";
import { SESSION_COOKIE_NAME } from "../../lib/auth/current-user";
import { createSession } from "../../lib/auth/session";
import { Prisma } from "../../../generated/prisma/client";

function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 60) || "teacher"
  );
}

export async function registerTeacherAction(formData: FormData): Promise<void> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const displayName = String(formData.get("displayName") ?? "").trim();
  const timezone = String(formData.get("timezone") ?? "Europe/Moscow").trim();

  if (!email || !password || !displayName) {
    redirect("/register?error=missing_fields");
  }
  if (password.length < 10) {
    // docs/AUTH.md doesn't pin an exact policy number — 10 chars is a placeholder minimum,
    // not a claimed final password policy; revisit alongside a real product decision.
    redirect("/register?error=weak_password");
  }

  let userId: string;
  try {
    const result = await registerTeacher({
      email,
      password,
      displayName,
      slug: slugify(displayName),
      timezone,
    });
    userId = result.userId;
  } catch (err) {
    // Only the actual unique-constraint violation (email or slug already taken) is mapped
    // to a user-facing message — docs/API.md §3 says never leak internal error details to
    // the client, but that's not licence to silently swallow and mislabel every other
    // failure as "email taken" too (a real bug caught here during Phase 1's own smoke test:
    // the first version of this catch block did exactly that, and hid a different failure
    // behind a misleading "email already exists" message). Anything else rethrows so it
    // surfaces in server logs / error tracking like a normal unexpected error.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      redirect("/register?error=email_taken");
    }
    throw err;
  }

  const session = await createSession(userId);

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, session.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    expires: session.expiresAt,
    path: "/",
  });

  redirect("/teacher/dashboard?welcome=1");
}
