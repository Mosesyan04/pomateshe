import { getCurrentUser } from "../../../lib/auth/current-user";

export default async function StudentDashboardPage() {
  const user = await getCurrentUser();

  return (
    <div>
      <h1>Личный кабинет ученика</h1>
      <p>Вы вошли как ученик (userId: {user?.userId}).</p>
      <p style={{ color: "#666" }}>
        Расписание, домашние задания, доска — Phase 2+ (docs/ROADMAP.md). Эта страница —
        минимальная заглушка, подтверждающая, что защита маршрута по роли работает.
      </p>
    </div>
  );
}
