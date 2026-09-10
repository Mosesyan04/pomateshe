"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revokeSession } from "../../lib/auth/session";
import { SESSION_COOKIE_NAME } from "../../lib/auth/current-user";

export async function logoutAction(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (token) {
    // Deletes the server-side Session row, not just the cookie (docs/AUTH.md §5) — a copied
    // cookie value stops working immediately, not just once the browser forgets it.
    await revokeSession(token);
  }

  cookieStore.delete(SESSION_COOKIE_NAME);
  redirect("/login");
}
