import { getCurrentUser } from "../../../lib/auth/current-user";

export default async function AdminDashboardPage() {
  const user = await getCurrentUser();

  return (
    <div>
      <h1>Личный кабинет администратора</h1>
      <p>Вы вошли как администратор (userId: {user?.userId}).</p>
      <p style={{ color: "#666" }}>
        Функциональность админ-кабинета не запланирована как отдельная фаза (docs/ROADMAP.md) —
        эта страница существует, чтобы у учётной записи администратора (docs/AUTH.md §3,
        создаётся через <code>scripts/create-admin.ts</code>) было куда попасть после входа.
      </p>
    </div>
  );
}
