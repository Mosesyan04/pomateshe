"use server";

import { redirect } from "next/navigation";
import { requireRole } from "../../../lib/auth/current-user";
import {
  createGroup,
  addStudentToGroup,
  removeStudentFromGroup,
  archiveGroup,
} from "../../../server/groups";

export async function createGroupAction(formData: FormData): Promise<void> {
  const user = await requireRole("teacher");
  const name = String(formData.get("name") ?? "").trim();

  if (!name) {
    redirect("/teacher/groups?error=missing_name");
  }

  await createGroup(user.teacherId!, name);
  redirect("/teacher/groups?created=1");
}

export async function addStudentToGroupAction(formData: FormData): Promise<void> {
  const user = await requireRole("teacher");
  const groupId = String(formData.get("groupId") ?? "");
  const studentLinkId = String(formData.get("studentLinkId") ?? "");

  if (!groupId || !studentLinkId) {
    redirect("/teacher/groups?error=missing_fields");
  }

  try {
    await addStudentToGroup(user.teacherId!, groupId, studentLinkId);
  } catch {
    redirect("/teacher/groups?error=add_failed");
  }

  redirect("/teacher/groups?added=1");
}

export async function removeStudentFromGroupAction(formData: FormData): Promise<void> {
  const user = await requireRole("teacher");
  const groupId = String(formData.get("groupId") ?? "");
  const studentLinkId = String(formData.get("studentLinkId") ?? "");

  try {
    await removeStudentFromGroup(user.teacherId!, groupId, studentLinkId);
  } catch {
    redirect("/teacher/groups?error=remove_failed");
  }

  redirect("/teacher/groups?removed=1");
}

export async function archiveGroupAction(formData: FormData): Promise<void> {
  const user = await requireRole("teacher");
  const groupId = String(formData.get("groupId") ?? "");

  try {
    await archiveGroup(user.teacherId!, groupId);
  } catch {
    redirect("/teacher/groups?error=archive_failed");
  }

  redirect("/teacher/groups?archived=1");
}
