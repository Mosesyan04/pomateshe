/**
 * Shared by dashboard.ts and income.ts — same "Группа: X" / student name convention as
 * /teacher/schedule's table (src/app/teacher/schedule/page.tsx), factored out once it was
 * about to be copied a third time.
 */
export function labelForLesson(lesson: {
  group: { name: string } | null;
  studentLink: { displayName: string | null; studentUser: { email: string } } | null;
}): string {
  if (lesson.group) return `Группа: ${lesson.group.name}`;
  return lesson.studentLink?.displayName ?? lesson.studentLink?.studentUser.email ?? "—";
}
