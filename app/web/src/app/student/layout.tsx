import { redirect } from "next/navigation";
import { getCurrentUser } from "../../lib/auth/current-user";
import { logoutAction } from "../logout/actions";

export default async function StudentLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login?next=/student/dashboard");
  }
  if (user.role !== "student") {
    redirect("/teacher/dashboard");
  }

  return (
    <div>
      <header style={{ display: "flex", justifyContent: "space-between", padding: "1rem" }}>
        <strong>Pomateshe — кабинет ученика</strong>
        <form action={logoutAction}>
          <button type="submit">Выйти</button>
        </form>
      </header>
      <main style={{ padding: "0 1rem" }}>{children}</main>
    </div>
  );
}
