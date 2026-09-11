import { sendEmail } from "../lib/email/send-email";

/**
 * The landing page's trial-lesson signup form (docs/ROADMAP.md Phase 6 — replacing the old
 * index.html's lead form, which posted to a now-untrusted Google Apps Script URL,
 * docs/THREAT_MODEL.md T-002). Deliberately NOT a new DB table/tenant entity: a lead is not
 * yet a student, not yet linked to any teacher account, and this page is the platform owner's
 * own bespoke marketing page, not a generic per-teacher feature — the simplest sufficient
 * thing is a direct notification email, matching the same "don't block on a real mailbox,
 * SMTP env vars, log instead if unset" approach already used for auth email (send-email.ts).
 *
 * `LEAD_NOTIFICATION_EMAIL` (the owner's inbox) is a separate concern from SMTP_* (how mail is
 * sent) — if it's unset, there's nowhere to send a notification to at all, so this logs the
 * lead instead of calling sendEmail with an empty recipient.
 */

export interface TrialRequestInput {
  name: string;
  contact: string;
  goal: string;
  ip: string;
}

const VALID_GOALS = new Set([
  "ОГЭ Математика (9 класс)",
  "ЕГЭ Базовая математика (10–11 класс)",
  "7–8 класс (подготовка к ОГЭ и геометрия)",
  "Повышение успеваемости (5–6 класс)",
]);

export interface TrialRequestResult {
  ok: boolean;
  error?: "invalid";
}

export async function submitTrialRequest(input: TrialRequestInput): Promise<TrialRequestResult> {
  const name = input.name.trim();
  const contact = input.contact.trim();
  const goal = input.goal.trim();

  if (!name || name.length > 200 || !contact || contact.length > 200 || !VALID_GOALS.has(goal)) {
    return { ok: false, error: "invalid" };
  }

  const notifyTo = process.env.LEAD_NOTIFICATION_EMAIL;
  const body = [
    `Имя: ${name}`,
    `Контакт: ${contact}`,
    `Цель: ${goal}`,
    `Время: ${new Date().toISOString()}`,
    `IP: ${input.ip}`,
  ].join("\n");

  if (!notifyTo) {
    console.log(`[trial-request:dev-mode] LEAD_NOTIFICATION_EMAIL not set — logging instead.\n${body}`);
    return { ok: true };
  }

  await sendEmail({
    to: notifyTo,
    subject: `Новая заявка на диагностику — ${name}`,
    text: body,
  });
  return { ok: true };
}
