import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const sendMailMock = vi.fn().mockResolvedValue(undefined);
const createTransportMock = vi.fn().mockReturnValue({ sendMail: sendMailMock });

vi.mock("nodemailer", () => ({
  createTransport: (...args: unknown[]) => createTransportMock(...args),
}));

// Static import is fine here: the transporter is memoized on globalThis (see
// send-email.ts's globalForEmail comment), not in module-local state, which is exactly why
// _resetEmailTransportForTests exists — clearing that cache is what lets each test's env vars
// actually take effect, not vi.resetModules() (which only clears the module registry, not
// globalThis).
import { sendEmail, _resetEmailTransportForTests } from "../send-email";

describe("sendEmail (SMTP via env vars, dev-mode log fallback)", () => {
  const originalEnv = { ...process.env };
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    _resetEmailTransportForTests();
    sendMailMock.mockClear();
    createTransportMock.mockClear();
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    for (const key of ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD", "SMTP_FROM", "SMTP_SECURE"]) {
      delete process.env[key];
    }
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    consoleLogSpy.mockRestore();
  });

  it("logs the message instead of sending when SMTP is not configured", async () => {
    await sendEmail({ to: "someone@example.com", subject: "Hi", text: "Hello there" });

    expect(createTransportMock).not.toHaveBeenCalled();
    expect(sendMailMock).not.toHaveBeenCalled();
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("[email:dev-mode]"));
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("someone@example.com"));
  });

  it("logs instead of sending when only SOME SMTP vars are set (partial config)", async () => {
    process.env.SMTP_HOST = "smtp.example.com";
    process.env.SMTP_PORT = "587";
    // SMTP_USER / SMTP_PASSWORD deliberately left unset.

    await sendEmail({ to: "someone@example.com", subject: "Hi", text: "Hello there" });

    expect(createTransportMock).not.toHaveBeenCalled();
    expect(consoleLogSpy).toHaveBeenCalled();
  });

  it("sends via SMTP when fully configured, using SMTP_USER as the from-address by default", async () => {
    process.env.SMTP_HOST = "smtp.yandex.ru";
    process.env.SMTP_PORT = "587";
    process.env.SMTP_USER = "noreply@example.com";
    process.env.SMTP_PASSWORD = "app-password";

    await sendEmail({ to: "student@example.com", subject: "Подтвердите email", text: "Ссылка: ..." });

    expect(createTransportMock).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "smtp.yandex.ru",
        port: 587,
        secure: false,
        auth: { user: "noreply@example.com", pass: "app-password" },
      }),
    );
    expect(sendMailMock).toHaveBeenCalledWith({
      from: "noreply@example.com",
      to: "student@example.com",
      subject: "Подтвердите email",
      text: "Ссылка: ...",
    });
    expect(consoleLogSpy).not.toHaveBeenCalled();
  });

  it("uses SMTP_FROM as the from-address when explicitly set", async () => {
    process.env.SMTP_HOST = "smtp.mail.ru";
    process.env.SMTP_PORT = "465";
    process.env.SMTP_USER = "login@example.com";
    process.env.SMTP_PASSWORD = "app-password";
    process.env.SMTP_FROM = "Pomateshe <noreply@pomateshe.example>";

    await sendEmail({ to: "x@example.com", subject: "s", text: "t" });

    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({ from: "Pomateshe <noreply@pomateshe.example>" }),
    );
  });

  it("defaults secure=true for port 465 and secure=false otherwise", async () => {
    process.env.SMTP_HOST = "smtp.example.com";
    process.env.SMTP_USER = "u";
    process.env.SMTP_PASSWORD = "p";
    process.env.SMTP_PORT = "465";

    await sendEmail({ to: "x@example.com", subject: "s", text: "t" });
    expect(createTransportMock).toHaveBeenLastCalledWith(expect.objectContaining({ secure: true }));
  });

  it("SMTP_SECURE explicitly overrides the port-based default", async () => {
    process.env.SMTP_HOST = "smtp.example.com";
    process.env.SMTP_USER = "u";
    process.env.SMTP_PASSWORD = "p";
    process.env.SMTP_PORT = "587"; // would default to secure=false
    process.env.SMTP_SECURE = "true"; // forced on anyway

    await sendEmail({ to: "x@example.com", subject: "s", text: "t" });
    expect(createTransportMock).toHaveBeenLastCalledWith(expect.objectContaining({ secure: true }));
  });

  it("throws a clear error when SMTP_PORT is not a number", async () => {
    process.env.SMTP_HOST = "smtp.example.com";
    process.env.SMTP_PORT = "not-a-number";
    process.env.SMTP_USER = "u";
    process.env.SMTP_PASSWORD = "p";

    await expect(sendEmail({ to: "x@example.com", subject: "s", text: "t" })).rejects.toThrow(/SMTP_PORT/);
  });

  it("re-reads env vars after _resetEmailTransportForTests, doesn't reuse a stale cached transporter", async () => {
    // First call with no SMTP config — falls back to logging.
    await sendEmail({ to: "a@example.com", subject: "s", text: "t" });
    expect(createTransportMock).not.toHaveBeenCalled();

    // Without a reset, a real caller wouldn't change env vars mid-process, but the test
    // helper exists precisely so tests CAN — confirming the cache is genuinely per-call-site
    // configurable, not just "works once at import time".
    _resetEmailTransportForTests();
    process.env.SMTP_HOST = "smtp.example.com";
    process.env.SMTP_PORT = "587";
    process.env.SMTP_USER = "u";
    process.env.SMTP_PASSWORD = "p";

    await sendEmail({ to: "b@example.com", subject: "s", text: "t" });
    expect(createTransportMock).toHaveBeenCalledTimes(1);
  });
});
