import { describe, it, expect, afterAll, vi } from "vitest";
import { registerTeacher } from "../teachers";
import {
  getCalendarIntegrationStatus,
  saveCalendarIntegration,
  disconnectCalendarIntegration,
  getUsableAccessToken,
} from "../calendar-integration";
import { decryptToken } from "../../lib/crypto/token-cipher";
import { GoogleTokenRefreshError } from "../../lib/google-calendar/errors";
import { withTenantContext } from "../tenant-context";
import { cleanupTestData } from "./test-helpers";
import { prisma } from "../db";

vi.mock("../../lib/google-calendar/client", () => ({
  refreshGoogleAccessToken: vi.fn(),
}));
import { refreshGoogleAccessToken } from "../../lib/google-calendar/client";
const refreshMock = vi.mocked(refreshGoogleAccessToken);

const createdUserIds: string[] = [];

afterAll(async () => {
  await cleanupTestData(createdUserIds);
  await prisma.$disconnect();
});

async function makeTeacher(label: string) {
  const t = await registerTeacher({
    email: `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
    password: "correct horse battery staple",
    displayName: `${label} teacher`,
    slug: `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    timezone: "Europe/Moscow",
  });
  createdUserIds.push(t.userId);
  return t;
}

describe("Calendar integration — connect/disconnect status", () => {
  it("a teacher who never connected shows connected: false, disabled: false", async () => {
    const teacher = await makeTeacher("calint-never");
    const status = await getCalendarIntegrationStatus(teacher.teacherId);
    expect(status).toEqual({ connected: false, disabled: false, googleAccountEmail: null });
  });

  it("saveCalendarIntegration stores tokens ENCRYPTED at rest, not as plaintext", async () => {
    const teacher = await makeTeacher("calint-encrypted");
    await saveCalendarIntegration(teacher.teacherId, {
      accessToken: "plaintext-access-token",
      refreshToken: "plaintext-refresh-token",
      expiresAt: new Date(Date.now() + 3600_000),
    });

    // Read the raw column values (not through getUsableAccessToken, which decrypts for you) —
    // this is specifically checking what's actually sitting in the DB row.
    const stored = await withTenantContext({ teacherId: teacher.teacherId }, (tx) =>
      tx.calendarIntegration.findUniqueOrThrow({ where: { teacherId: teacher.teacherId } }),
    );
    expect(stored.accessTokenEncrypted).not.toContain("plaintext-access-token");
    expect(stored.refreshTokenEncrypted).not.toContain("plaintext-refresh-token");
    expect(decryptToken(stored.accessTokenEncrypted!)).toBe("plaintext-access-token");
    expect(decryptToken(stored.refreshTokenEncrypted!)).toBe("plaintext-refresh-token");
  });

  it("getCalendarIntegrationStatus reflects connected after saving", async () => {
    const teacher = await makeTeacher("calint-connected");
    await saveCalendarIntegration(teacher.teacherId, {
      accessToken: "at",
      refreshToken: "rt",
      expiresAt: new Date(Date.now() + 3600_000),
    });
    const status = await getCalendarIntegrationStatus(teacher.teacherId);
    expect(status).toEqual({ connected: true, disabled: false, googleAccountEmail: null });
  });

  it("disconnectCalendarIntegration removes the row; calling it twice is a harmless no-op", async () => {
    const teacher = await makeTeacher("calint-disconnect");
    await saveCalendarIntegration(teacher.teacherId, {
      accessToken: "at",
      refreshToken: "rt",
      expiresAt: new Date(Date.now() + 3600_000),
    });
    await disconnectCalendarIntegration(teacher.teacherId);
    expect(await getCalendarIntegrationStatus(teacher.teacherId)).toEqual({
      connected: false,
      disabled: false,
      googleAccountEmail: null,
    });
    await expect(disconnectCalendarIntegration(teacher.teacherId)).resolves.toBeUndefined();
  });

  it("connecting one teacher's calendar never affects a different teacher's status", async () => {
    const teacherA = await makeTeacher("calint-cross-a");
    const teacherB = await makeTeacher("calint-cross-b");
    await saveCalendarIntegration(teacherA.teacherId, {
      accessToken: "at-a",
      refreshToken: "rt-a",
      expiresAt: new Date(Date.now() + 3600_000),
    });
    expect((await getCalendarIntegrationStatus(teacherA.teacherId)).connected).toBe(true);
    expect((await getCalendarIntegrationStatus(teacherB.teacherId)).connected).toBe(false);
  });
});

describe("getUsableAccessToken", () => {
  it("returns null for a teacher who never connected", async () => {
    const teacher = await makeTeacher("usable-never");
    expect(await getUsableAccessToken(teacher.teacherId)).toBeNull();
  });

  it("returns the stored access token without refreshing when it's still valid", async () => {
    refreshMock.mockReset();
    const teacher = await makeTeacher("usable-valid");
    await saveCalendarIntegration(teacher.teacherId, {
      accessToken: "still-valid-token",
      refreshToken: "rt",
      expiresAt: new Date(Date.now() + 3600_000),
    });
    const usable = await getUsableAccessToken(teacher.teacherId);
    expect(usable).toEqual({ accessToken: "still-valid-token", calendarId: "primary" });
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("refreshes and persists a new access token when the stored one is expired", async () => {
    refreshMock.mockReset();
    refreshMock.mockResolvedValueOnce({ accessToken: "refreshed-token", expiresAt: new Date(Date.now() + 3600_000) });

    const teacher = await makeTeacher("usable-expired");
    await saveCalendarIntegration(teacher.teacherId, {
      accessToken: "old-token",
      refreshToken: "rt",
      expiresAt: new Date(Date.now() - 1000), // already expired
    });

    const usable = await getUsableAccessToken(teacher.teacherId);
    expect(usable?.accessToken).toBe("refreshed-token");
    expect(refreshMock).toHaveBeenCalledTimes(1);

    // Persisted — a second call with the mock now throwing must NOT need to refresh again.
    refreshMock.mockReset();
    refreshMock.mockRejectedValueOnce(new Error("should not be called"));
    const usableAgain = await getUsableAccessToken(teacher.teacherId);
    expect(usableAgain?.accessToken).toBe("refreshed-token");
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("disables the integration when the refresh token is invalid (revoked), and returns null", async () => {
    refreshMock.mockReset();
    refreshMock.mockRejectedValueOnce(new GoogleTokenRefreshError(400, "invalid_grant", true));

    const teacher = await makeTeacher("usable-revoked");
    await saveCalendarIntegration(teacher.teacherId, {
      accessToken: "old-token",
      refreshToken: "revoked-rt",
      expiresAt: new Date(Date.now() - 1000),
    });

    expect(await getUsableAccessToken(teacher.teacherId)).toBeNull();
    expect(await getCalendarIntegrationStatus(teacher.teacherId)).toEqual({
      connected: false,
      disabled: true,
      googleAccountEmail: null,
    });

    // A disabled integration must not even attempt another refresh call.
    refreshMock.mockReset();
    expect(await getUsableAccessToken(teacher.teacherId)).toBeNull();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("returns null WITHOUT disabling on a transient refresh failure (rate limit / network)", async () => {
    refreshMock.mockReset();
    refreshMock.mockRejectedValueOnce(new GoogleTokenRefreshError(503, "Service Unavailable", false));

    const teacher = await makeTeacher("usable-transient");
    await saveCalendarIntegration(teacher.teacherId, {
      accessToken: "old-token",
      refreshToken: "rt",
      expiresAt: new Date(Date.now() - 1000),
    });

    expect(await getUsableAccessToken(teacher.teacherId)).toBeNull();
    expect(await getCalendarIntegrationStatus(teacher.teacherId)).toEqual({
      connected: true,
      disabled: false,
      googleAccountEmail: null,
    });
  });
});
