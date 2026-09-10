/**
 * Shared revision date for the offer/privacy-policy texts (both documents carry the same
 * "Дата редакции" as of Phase 2). Bumping this string is the only thing that makes
 * ConsentRecord treat a previously-given consent as stale (docs/CONSENTS.md §2) — it is NOT
 * tied to a code deploy, only to an actual change in the legal text itself.
 */
export const POLICY_VERSION = "2026-09-10";
