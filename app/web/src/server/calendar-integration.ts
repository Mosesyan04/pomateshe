import { withTenantContext } from "./tenant-context";
import { encryptToken, decryptToken } from "../lib/crypto/token-cipher";
import { refreshGoogleAccessToken } from "../lib/google-calendar/client";
import { GoogleTokenRefreshError } from "../lib/google-calendar/errors";

/**
 * CalendarIntegration is tenant-scoped by teacherId (docs/MULTI_TENANCY.md §2.2's ordinary
 * "teacherId column" pattern, same RLS shape as Lesson/Group/Homework) — only a teacher ever
 * connects Google Calendar (docs/CALENDAR.md §1: students never see this).
 */

export interface CalendarIntegrationStatus {
  connected: boolean;
  /** Set when a stored refresh_token turned out to be dead (docs/CALENDAR.md §4) — the
   *  teacher must reconnect; sync silently stops until they do. */
  disabled: boolean;
  googleAccountEmail: string | null;
}

export async function getCalendarIntegrationStatus(teacherId: string): Promise<CalendarIntegrationStatus> {
  return withTenantContext({ teacherId }, async (tx) => {
    const integration = await tx.calendarIntegration.findUnique({ where: { teacherId } });
    if (!integration) return { connected: false, disabled: false, googleAccountEmail: null };
    return {
      connected: integration.disabledAt == null,
      disabled: integration.disabledAt != null,
      googleAccountEmail: integration.googleAccountEmail,
    };
  });
}

export interface FreshGoogleTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

/**
 * Called once, right after the OAuth callback exchanges a code for tokens. `upsert` because a
 * teacher can disconnect and later reconnect — that's a fresh row logically, but reusing the
 * same CalendarIntegration row (unique on teacherId) means Lesson.calendarEventId links from a
 * *previous* connection don't need separate cleanup bookkeeping; a reconnect starts syncing
 * again as if calendarId/tokens were simply refreshed, not created from scratch.
 */
export async function saveCalendarIntegration(teacherId: string, tokens: FreshGoogleTokens): Promise<void> {
  return withTenantContext({ teacherId }, async (tx) => {
    const data = {
      accessTokenEncrypted: encryptToken(tokens.accessToken),
      refreshTokenEncrypted: encryptToken(tokens.refreshToken),
      tokenExpiresAt: tokens.expiresAt,
      disabledAt: null,
    };
    await tx.calendarIntegration.upsert({
      where: { teacherId },
      create: { teacherId, calendarId: "primary", ...data },
      update: data,
    });
  });
}

/** "Отключить" on /teacher/profile — deleteMany (not delete) so calling it twice, or on a
 *  teacher who never connected, is a harmless no-op rather than a thrown not-found error. */
export async function disconnectCalendarIntegration(teacherId: string): Promise<void> {
  return withTenantContext({ teacherId }, async (tx) => {
    await tx.calendarIntegration.deleteMany({ where: { teacherId } });
  });
}

export interface UsableGoogleAccess {
  accessToken: string;
  calendarId: string;
}

/**
 * The one function calendar-sync.ts calls before ever talking to Google. Returns null for
 * every "don't sync" case (never connected, previously disabled) instead of throwing — those
 * are ordinary, silent no-sync states for best-effort sync, not error conditions the caller
 * needs to react to (docs/CALENDAR.md §4: a lesson create/reschedule must always succeed in
 * Pomateshe regardless of Google's state).
 *
 * Refreshes and persists a new access token when the stored one is expired (or expiring within
 * the next minute) — callers never see a stale token or need to know refresh happened at all.
 */
export async function getUsableAccessToken(teacherId: string): Promise<UsableGoogleAccess | null> {
  return withTenantContext({ teacherId }, async (tx) => {
    const integration = await tx.calendarIntegration.findUnique({ where: { teacherId } });
    if (!integration || integration.disabledAt || !integration.refreshTokenEncrypted) {
      return null;
    }

    const calendarId = integration.calendarId ?? "primary";
    const REFRESH_SAFETY_MARGIN_MS = 60_000;
    const stillValid =
      integration.accessTokenEncrypted != null &&
      integration.tokenExpiresAt != null &&
      integration.tokenExpiresAt.getTime() - Date.now() > REFRESH_SAFETY_MARGIN_MS;

    if (stillValid) {
      return { accessToken: decryptToken(integration.accessTokenEncrypted!), calendarId };
    }

    try {
      const refreshed = await refreshGoogleAccessToken(decryptToken(integration.refreshTokenEncrypted));
      await tx.calendarIntegration.update({
        where: { teacherId },
        data: {
          accessTokenEncrypted: encryptToken(refreshed.accessToken),
          tokenExpiresAt: refreshed.expiresAt,
        },
      });
      return { accessToken: refreshed.accessToken, calendarId };
    } catch (err) {
      if (err instanceof GoogleTokenRefreshError && err.invalidGrant) {
        // The refresh_token itself is dead (revoked in the user's Google Account) — this
        // integration cannot recover on its own. Disable it now so every subsequent sync
        // attempt short-circuits at the `integration.disabledAt` check above instead of
        // re-attempting (and re-failing) the same refresh call every time.
        await tx.calendarIntegration.update({ where: { teacherId }, data: { disabledAt: new Date() } });
      }
      // Anything else (rate limit, network, Google outage) is transient — leave the
      // integration enabled, the next sync attempt tries again on its own.
      return null;
    }
  });
}
