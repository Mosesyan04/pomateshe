import { requireRole } from "../../../../lib/auth/current-user";
import { resolveWhiteboardForStudent } from "../../../../server/whiteboard";
import { WhiteboardCanvas } from "../../../_components/whiteboard/WhiteboardCanvas";

/** Mirror of the teacher whiteboard page — see that file's comment for why this pre-check
 *  exists alongside WhiteboardCanvas's own client-side token fetch. */
export default async function StudentWhiteboardPage({ params }: { params: Promise<{ lessonId: string }> }) {
  const { lessonId } = await params;
  const user = await requireRole("student");

  const access = await resolveWhiteboardForStudent(user.userId, lessonId);
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
