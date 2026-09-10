/**
 * docs/SECURITY.md §4: "Для single-instance деплоя достаточно in-memory лимитера ... Redis
 * подключается только при горизонтальном масштабировании". This is that in-memory limiter —
 * a plain fixed-window counter, not sliding-window, deliberately: this platform runs one
 * process (docs/ARCHITECTURE.md §3), so there's no cross-instance state to reconcile, and a
 * fixed window is the simplest thing that actually stops brute-forcing (Правило 10 ТЗ).
 *
 * State lives in a module-level Map, kept across Next.js dev-mode hot reloads via globalThis
 * (same pattern as src/server/db.ts's Prisma singleton) so a code edit doesn't reset
 * everyone's rate limit mid-development. In production this is one process's memory, which
 * is exactly the deployment this is designed for — if the app ever runs as multiple
 * instances behind a load balancer, this stops being sufficient and needs Redis, per the
 * docs comment above; that's a deliberate future trigger, not a silent gap.
 *
 * Two primitives, not one, because login and registration count differently:
 * - Login (docs/AUTH.md §4) blocks after N *failed* attempts on (IP, email) — a successful
 *   login must never count against the limit, or a legitimate user who mistypes once and
 *   then gets it right would still be throttled. Use `isRateLimited` before attempting the
 *   login, then `recordAttempt` only if it fails.
 * - Registration (docs/SECURITY.md §4) throttles by IP regardless of outcome — every POST
 *   consumes resources and is worth capping, taken or not. Use `checkAndRecord`.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const globalForRateLimit = globalThis as unknown as { rateLimitBuckets?: Map<string, Bucket> };
const buckets = globalForRateLimit.rateLimitBuckets ?? new Map<string, Bucket>();
if (process.env.NODE_ENV !== "production") {
  globalForRateLimit.rateLimitBuckets = buckets;
}

let callsSinceSweep = 0;

/** Opportunistic cleanup so long-lived buckets for one-off (ip, email) pairs don't accumulate
 *  forever — runs every 200 calls rather than on a timer, so it costs nothing when idle. */
function sweepExpired(now: number): void {
  callsSinceSweep += 1;
  if (callsSinceSweep < 200) return;
  callsSinceSweep = 0;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export interface RateLimitResult {
  limited: boolean;
  /** Only set when `limited` is true. */
  retryAfterSeconds?: number;
}

/** Read-only check — does not consume an attempt. */
export function isRateLimited(key: string, limit: number): RateLimitResult {
  const now = Date.now();
  sweepExpired(now);

  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) return { limited: false };
  if (bucket.count >= limit) {
    return { limited: true, retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000) };
  }
  return { limited: false };
}

/** Consumes one attempt against the window, starting a fresh window if the last one expired. */
export function recordAttempt(key: string, windowMs: number): void {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
  } else {
    bucket.count += 1;
  }
}

/** Check-and-record in one call, for endpoints where every attempt counts regardless of outcome. */
export function checkAndRecord(key: string, limit: number, windowMs: number): RateLimitResult {
  const result = isRateLimited(key, limit);
  if (result.limited) return result;
  recordAttempt(key, windowMs);
  return { limited: false };
}

/** Test-only escape hatch — production code never needs to clear this. */
export function _resetRateLimitsForTests(): void {
  buckets.clear();
}
