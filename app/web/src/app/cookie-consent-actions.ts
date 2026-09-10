"use server";

import { getCurrentUser } from "../lib/auth/current-user";
import { getClientIp } from "../lib/http/client-ip";
import { recordConsent } from "../server/consents";
import { POLICY_VERSION } from "../lib/legal/policy-version";
import { headers } from "next/headers";

/**
 * Called from the client-side cookie banner (src/app/_components/cookie-banner.tsx) on
 * "Принять". localStorage is the record for an anonymous visitor (docs/CONSENTS.md §3); this
 * is the best-effort addition for a signed-in one — a no-op, not an error, when nobody's
 * logged in, since there's no userId to attach a ConsentRecord to.
 */
export async function recordCookieAnalyticsConsentAction(): Promise<void> {
  const user = await getCurrentUser();
  if (!user) return;

  const ip = await getClientIp();
  const userAgent = (await headers()).get("user-agent");
  await recordConsent({
    userId: user.userId,
    types: ["cookie_analytics"],
    policyVersion: POLICY_VERSION,
    ip,
    userAgent,
  });
}
