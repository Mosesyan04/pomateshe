import { requireRole } from "../../../../lib/auth/current-user";
import { resolveWhiteboardForTeacher } from "../../../../server/whiteboard";
import { WhiteboardCanvas } from "../../../_components/whiteboard/WhiteboardCanvas";

/**
 * Server-side access pre-check (docs/WHITEBOARD.md §3) before even rendering the client canvas
 * shell, so an out-of-window or foreign lesson shows a clear message instead of a blank canvas
 * that then fails its own token fetch. WhiteboardCanvas re-runs this exact same check itself on
 * mount (via POST /api/whiteboard/:lessonId/token) — this page's check is only a better first
 * paint, never the actual authorization boundary.
 */
export default async function TeacherWhiteboardPage({ params }: { params: Promise<{ lessonId: string }> }) {
  const { lessonId } = await params;
  const user = await requireRole("teacher");

  const access = await resolveWhiteboardForTeacher(user.teacherId!, lessonId);
  if (!access.ok) {
    return (
      <p style={{ color: "#666" }}>
        {access.reason === "outside_window"
          ? `Доска станет доступна к началу занятия (${access.availableFrom.toLocaleString("ru-RU")}).`
          : "Занятие не найдено."}
      </p>
    );
  }

  return (
    <div>
      <h1>Доска</h1>
      <WhiteboardCanvas lessonId={lessonId} />
    </div>
  );
}
