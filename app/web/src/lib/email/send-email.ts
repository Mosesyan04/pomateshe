import { createTransport, type Transporter } from "nodemailer";

/**
 * Plain SMTP, configured entirely via env vars (SMTP_HOST/PORT/USER/PASSWORD/FROM) — works
 * with any provider that speaks SMTP (Яндекс, Mail.ru, Gmail, a self-hosted Postfix, ...), no
 * provider-specific SDK. Unlike src/lib/google-calendar/client.ts's plain-`fetch` pattern,
 * SMTP is a stateful, non-HTTP protocol (EHLO/STARTTLS/AUTH/DATA, MIME encoding) — there's no
 * REST endpoint to `fetch()` against, so a proper client is a real need here, not a preference;
 * `nodemailer` is the de facto standard for this in Node, not a provider-specific dependency.
 *
 * No real mailbox is configured yet (the platform owner will provide one when moving to
 * hosting, same as Google Calendar's OAuth credentials, docs/CALENDAR.md §8) — until
 * SMTP_HOST etc. are set, this logs the full message instead of sending it, loudly, so a
 * password-reset or verification link stays retrievable from the server log during
 * development/testing.
 */
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  from: string;
  secure: boolean;
}

function readSmtpConfig(): SmtpConfig | null {
  const host = process.env.SMTP_HOST;
  const portRaw = process.env.SMTP_PORT;
  const user = process.env.SMTP_USER;
  const password = process.env.SMTP_PASSWORD;

  if (!host || !portRaw || !user || !password) return null;

  const port = Number(portRaw);
  if (!Number.isFinite(port)) {
    throw new Error(`SMTP_PORT must be a number, got "${portRaw}".`);
  }

  // SMTP_SECURE lets a provider that needs it forced either way override the default; absent,
  // port 465 (implicit TLS) defaults to secure, everything else (587/25, STARTTLS) doesn't —
  // nodemailer's own convention, not something this project invents.
  const secure = process.env.SMTP_SECURE != null ? process.env.SMTP_SECURE === "true" : port === 465;

  return { host, port, user, password, from: process.env.SMTP_FROM || user, secure };
}

// Singleton, kept across dev-mode hot reloads via globalThis — same reasoning as
// src/server/db.ts's Prisma client and src/lib/rate-limit.ts's bucket map: a code edit
// shouldn't force a fresh SMTP connection setup on every save.
const globalForEmail = globalThis as unknown as { emailTransporter?: Transporter | null };

function getTransporter(): Transporter | null {
  if (globalForEmail.emailTransporter !== undefined) return globalForEmail.emailTransporter;

  const config = readSmtpConfig();
  const transporter = config
    ? createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        auth: { user: config.user, pass: config.password },
      })
    : null;

  if (process.env.NODE_ENV !== "production" || transporter) {
    globalForEmail.emailTransporter = transporter;
  }
  return transporter;
}

export async function sendEmail(message: EmailMessage): Promise<void> {
  const transporter = getTransporter();

  if (!transporter) {
    console.log(
      `[email:dev-mode] SMTP is not configured (SMTP_HOST/PORT/USER/PASSWORD) — logging instead of sending.\n` +
        `  To: ${message.to}\n  Subject: ${message.subject}\n  ${message.text.replace(/\n/g, "\n  ")}`,
    );
    return;
  }

  const from = readSmtpConfig()!.from;
  await transporter.sendMail({ from, to: message.to, subject: message.subject, text: message.text });
}

/** Test-only escape hatch — same pattern as rate-limit.ts's _resetRateLimitsForTests. Lets a
 *  test change SMTP_* env vars mid-suite and force the next sendEmail call to re-read them,
 *  instead of reusing whatever transporter (or lack of one) the first call cached. */
export function _resetEmailTransportForTests(): void {
  globalForEmail.emailTransporter = undefined;
}
