import { getCurrentUser } from "../../../lib/auth/current-user";

export default async function TeacherDashboardPage() {
  // Layout already redirected anyone who isn't an authenticated teacher — this call is
  // memoized (React cache()) so it doesn't cost a second DB round trip.
  const user = await getCurrentUser();

  return (
    <div>
      <h1>Личный кабинет</h1>
      <p>Вы вошли как преподаватель (userId: {user?.userId}).</p>
      <p>
        <a href="/teacher/students">Ученики и приглашения</a> ·{" "}
        <a href="/teacher/schedule">Расписание</a>
      </p>
      <p style={{ color: "#666" }}>
        Домашние задания, доска, доходы — Phase 2+ (docs/ROADMAP.md).
      </p>
    </div>
  );
}
