import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const sendEmailMock = vi.fn().mockResolvedValue(undefined);
vi.mock("../../lib/email/send-email", () => ({
  sendEmail: (...args: unknown[]) => sendEmailMock(...args),
}));

import { submitTrialRequest } from "../trial-requests";

describe("submitTrialRequest", () => {
  const originalEnv = { ...process.env };
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    sendEmailMock.mockClear();
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    delete process.env.LEAD_NOTIFICATION_EMAIL;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    consoleLogSpy.mockRestore();
  });

  const validInput = {
    name: "Ольга",
    contact: "+7 999 000-00-00",
    goal: "ОГЭ Математика (9 класс)",
    ip: "203.0.113.1",
  };

  it("logs instead of emailing when LEAD_NOTIFICATION_EMAIL is not set", async () => {
    const result = await submitTrialRequest(validInput);
    expect(result).toEqual({ ok: true });
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Ольга"));
  });

  it("sends a notification email when LEAD_NOTIFICATION_EMAIL is set", async () => {
    process.env.LEAD_NOTIFICATION_EMAIL = "artem@example.com";
    const result = await submitTrialRequest(validInput);

    expect(result).toEqual({ ok: true });
    expect(sendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "artem@example.com",
        subject: expect.stringContaining("Ольга"),
        text: expect.stringContaining("+7 999 000-00-00"),
      }),
    );
  });

  it("rejects an empty name", async () => {
    const result = await submitTrialRequest({ ...validInput, name: "   " });
    expect(result).toEqual({ ok: false, error: "invalid" });
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("rejects an empty contact", async () => {
    const result = await submitTrialRequest({ ...validInput, contact: "" });
    expect(result).toEqual({ ok: false, error: "invalid" });
  });

  it("rejects a goal that isn't one of the offered tracks (tampered client)", async () => {
    const result = await submitTrialRequest({ ...validInput, goal: "Что угодно другое" });
    expect(result).toEqual({ ok: false, error: "invalid" });
  });

  it("rejects a name over the length limit", async () => {
    const result = await submitTrialRequest({ ...validInput, name: "а".repeat(201) });
    expect(result).toEqual({ ok: false, error: "invalid" });
  });

  it("includes the submitter's IP in the notification for abuse tracing", async () => {
    process.env.LEAD_NOTIFICATION_EMAIL = "artem@example.com";
    await submitTrialRequest(validInput);
    expect(sendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining("203.0.113.1") }),
    );
  });
});
