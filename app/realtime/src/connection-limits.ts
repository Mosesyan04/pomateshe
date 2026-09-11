/**
 * Per-connection guards — docs/WHITEBOARD.md §6 / docs/THREAT_MODEL.md §4: "Флуд сообщений от
 * клиента" and "ограничение размера payload" are two different measures with different
 * severities. A message that's simply too large is unambiguous (a bug or an attack, never
 * legitimate for a drawing delta) — close the connection. A burst of many small messages
 * could be a legitimate fast scribble — drop the excess instead of punishing the whole
 * session for it.
 *
 * Deliberately simpler than app/web/src/lib/rate-limit.ts: that one needs a shared Map because
 * HTTP requests are stateless across calls; a WebSocket connection is a single long-lived
 * object, so its own counters can just be closed-over local state, one instance per
 * connection — no shared map, no cross-connection key collisions possible.
 */

export const MAX_MESSAGE_BYTES = 256 * 1024; // generous — a drawing delta is KB-sized (docs/WHITEBOARD.md §7)
const MESSAGES_PER_WINDOW = 100;
const WINDOW_MS = 1000;

export function isOversized(byteLength: number): boolean {
  return byteLength > MAX_MESSAGE_BYTES;
}

export function createMessageRateLimiter() {
  // Lazily initialized on the first real call, from whatever `now` that call passes — not
  // eagerly from the real clock at creation time, which would make the counter deaf to a
  // caller-supplied `now` (as tests do) until enough real wall-clock time had also passed.
  let windowStart: number | null = null;
  let count = 0;

  /** Returns true if this message is within budget (process it), false if it should be
   *  silently dropped (over budget for the current window). */
  return function allowMessage(now: number = Date.now()): boolean {
    if (windowStart === null || now - windowStart >= WINDOW_MS) {
      windowStart = now;
      count = 0;
    }
    count += 1;
    return count <= MESSAGES_PER_WINDOW;
  };
}
