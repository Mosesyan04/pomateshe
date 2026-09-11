"use server";

import { redirect } from "next/navigation";
import { submitTrialRequest } from "../server/trial-requests";
import { checkAndRecord } from "../lib/rate-limit";
import { getClientIp } from "../lib/http/client-ip";

const TRIAL_REQUEST_LIMIT = 5;
const TRIAL_REQUEST_WINDOW_MS = 60 * 60 * 1000; // generous — a real family submitting twice shouldn't hit this

export async function submitTrialRequestAction(formData: FormData): Promise<void> {
  // Honeypot: a hidden field no real visitor sees or fills; only a bot filling every input
  // blindly would populate it. Silently "succeeds" (no error, no redirect signal a bot could
  // learn from) without ever sending a notification.
  if (String(formData.get("website") ?? "").trim() !== "") {
    redirect("/?sent=1#trial-form");
  }

  const consentGiven = formData.get("consent") === "on";
  if (!consentGiven) {
    redirect("/?error=missing_consent#trial-form");
  }

  const ip = await getClientIp();
  const { limited } = checkAndRecord(`trial-request:${ip}`, TRIAL_REQUEST_LIMIT, TRIAL_REQUEST_WINDOW_MS);
  if (limited) {
    redirect("/?error=rate_limited#trial-form");
  }

  const result = await submitTrialRequest({
    name: String(formData.get("name") ?? ""),
    contact: String(formData.get("contact") ?? ""),
    goal: String(formData.get("goal") ?? ""),
    ip,
  });

  if (!result.ok) {
    redirect("/?error=invalid#trial-form");
  }
  redirect("/?sent=1#trial-form");
}
