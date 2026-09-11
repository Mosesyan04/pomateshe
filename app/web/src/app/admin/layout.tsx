import { redirect } from "next/navigation";
import { getCurrentUser, dashboardPathForRole } from "../../lib/auth/current-user";
import { logoutAction } from "../logout/actions";

/**
 * Mirrors src/app/teacher/layout.tsx and src/app/student/layout.tsx's shape exactly — the
 * real role check for everything under /admin, not just a UX redirect. There is no admin
 * feature surface yet (docs/ROADMAP.md never scheduled one; docs/AUTH.md §3 only asks for
 * accounts to exist, created manually via scripts/create-admin.ts) — this layout and its one
 * page exist so an admin account has somewhere to land after login instead of bouncing
 * between /teacher and /student forever (both of those layouts used to hardcode "the other"
 * role's dashboard as their redirect target for anyone who wasn't a match, which only ever
 * mattered while teacher/student were the only two roles that could reach a protected layout —
 * see the dashboardPathForRole comment in src/lib/auth/current-user.ts for the actual bug this
 * fixed).
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login?next=/admin/dashboard");
  }
  if (user.role !== "admin") {
    redirect(dashboardPathForRole(user.role));
  }

  return (
    <div>
      <header style={{ display: "flex", justifyContent: "space-between", padding: "1rem" }}>
        <strong>Pomateshe — кабинет администратора</strong>
        <form action={logoutAction}>
          <button type="submit">Выйти</button>
        </form>
      </header>
      <main style={{ padding: "0 1rem" }}>{children}</main>
    </div>
  );
}
