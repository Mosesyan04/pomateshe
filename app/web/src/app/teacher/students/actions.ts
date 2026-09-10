"use server";

import { redirect } from "next/navigation";
import { requireRole } from "../../../lib/auth/current-user";
import { createInvite, revokeInvite } from "../../../server/invites";

export async function createInviteAction(formData: FormData): Promise<void> {
  const user = await requireRole("teacher");
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();

  if (!email || !email.includes("@")) {
    redirect("/teacher/students?error=invalid_email");
  }

  // user.teacherId is guaranteed set here — requireRole("teacher") only returns after
  // getCurrentUser() has confirmed a TeacherProfile exists (see current-user.ts).
  const invite = await createInvite(user.teacherId!, email);

  // The raw token is shown exactly once, via this redirect — it is never stored anywhere
  // (only its hash is, docs/AUTH.md §2), so this is the only chance to hand it to the
  // teacher to copy/send. There is no email-sending integration yet (out of scope for
  // Phase 1, docs/ROADMAP.md) — the teacher shares the link manually for now.
  redirect(`/teacher/students?created=1&token=${invite.token}`);
}

export async function revokeInviteAction(formData: FormData): Promise<void> {
  const user = await requireRole("teacher");
  const inviteId = String(formData.get("inviteId") ?? "");

  if (inviteId) {
    await revokeInvite(user.teacherId!, inviteId);
  }

  redirect("/teacher/students?revoked=1");
}
