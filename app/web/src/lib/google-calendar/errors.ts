/**
 * Thrown by refreshGoogleAccessToken (client.ts) when Google rejects a refresh_token request.
 * `invalidGrant` distinguishes "the user revoked access in their Google Account — this
 * integration is dead until they reconnect" (docs/CALENDAR.md §4) from a merely transient
 * failure (rate limit, network blip, Google outage) that's worth quietly retrying next sync
 * rather than disabling the integration over.
 */
export class GoogleTokenRefreshError extends Error {
  readonly invalidGrant: boolean;

  constructor(status: number, body: string, invalidGrant: boolean) {
    super(`Google token refresh failed (${status}): ${body}`);
    this.name = "GoogleTokenRefreshError";
    this.invalidGrant = invalidGrant;
  }
}
