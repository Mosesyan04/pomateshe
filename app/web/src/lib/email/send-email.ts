/**
 * No real email transport (SMTP/provider API) is wired up yet — no such infrastructure
 * exists anywhere else in this project either, and picking a provider is a product decision,
 * not a mechanical one (same reasoning as docs/CALENDAR.md's Google OAuth: build the feature
 * complete except for the literal "send bytes to a third party" part, which needs real
 * credentials from the platform owner).
 *
 * Until `EMAIL_TRANSPORT_CONFIGURED` work happens, this logs the full message instead of
 * sending it — loudly (not a silent no-op), so a password-reset or verification link is
 * always retrievable from the server log during development/testing. Swapping in a real
 * provider later means filling in the `else` branch below with one HTTP call (this project's
 * established pattern — see src/lib/google-calendar/client.ts — is a plain `fetch` against
 * the provider's REST API, not a new SDK dependency), not restructuring any caller.
 */
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export async function sendEmail(message: EmailMessage): Promise<void> {
  // No env var check gates this on purpose — there is no real transport to check for yet.
  console.log(
    `[email:dev-mode] Real email delivery is not configured — logging instead.\n` +
      `  To: ${message.to}\n  Subject: ${message.subject}\n  ${message.text.replace(/\n/g, "\n  ")}`,
  );
}
