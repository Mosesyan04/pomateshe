import { headers } from "next/headers";

/**
 * Server Actions don't receive a request/NextRequest object directly, so the client IP has
 * to come from headers — which only carry a real value once a reverse proxy (Caddy/nginx,
 * docs/DEPLOYMENT.md §2) sets X-Forwarded-For. Without one in front (bare local dev), there
 * is no real client IP to read, and the fallback below intentionally collapses everyone to
 * one shared bucket rather than pretending to distinguish clients it can't actually see.
 */
export async function getClientIp(): Promise<string> {
  const headerList = await headers();

  const forwardedFor = headerList.get("x-forwarded-for");
  if (forwardedFor) {
    // Left-most entry is the original client per the standard convention; a trusted proxy
    // is what appends further entries after it, not before — so leading, not trailing.
    return forwardedFor.split(",")[0].trim();
  }

  const realIp = headerList.get("x-real-ip");
  if (realIp) return realIp.trim();

  return "unknown-no-proxy";
}
