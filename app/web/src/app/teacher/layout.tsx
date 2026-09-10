import { redirect } from "next/navigation";
import { getCurrentUser } from "../../lib/auth/current-user";
import { logoutAction } from "../logout/actions";

/**
 * The real role check for everything under /teacher — src/proxy.ts only redirected based on
 * cookie presence; this is the DB-backed check docs/ARCHITECTURE.md §5 requires. A student
 * (or anyone with no valid session at all) hitting /teacher/* lands here and is redirected,
 * never sees any teacher-only content or data.
 */
export default async function TeacherLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login?next=/teacher/dashboard");
  }
  if (user.role !== "teacher") {
    // Authenticated, but as the wrong role — a student who wandered into /teacher/* by
    // typing the URL. Send them to their own area rather than a generic 403 page (not built
    // yet), still never rendering teacher content for them.
    redirect("/student/dashboard");
  }

  return (
    <div>
      <header style={{ display: "flex", justifyContent: "space-between", padding: "1rem" }}>
        <strong>Pomateshe — кабинет преподавателя</strong>
        <form action={logoutAction}>
          <button type="submit">Выйти</button>
        </form>
      </header>
      <main style={{ padding: "0 1rem" }}>{children}</main>
    </div>
  );
}
