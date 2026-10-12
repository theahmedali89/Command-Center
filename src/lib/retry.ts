/** Error classes driving retry discipline. Matches §7 of the plan. */
export type ErrorClass =
  | "RETRYABLE_ERROR"
  | "PERMANENT_ERROR"
  | "AUTH_REQUIRED"
  | "RATE_LIMITED";

/** Hard cap on publish attempts per ScheduledPost. No infinite loops. */
export const MAX_ATTEMPTS = 5;

const FIVE_MINUTES_MS = 5 * 60 * 1000;
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

/**
 * Map a provider's machine error code to a retry class.
 * Unknown codes default to RETRYABLE_ERROR so transient failures recover.
 */
export function classifyPublishError(code?: string): ErrorClass {
  switch (code) {
    case "RATE_LIMITED":
      return "RATE_LIMITED";
    case "AUTH_REQUIRED":
    case "TOKEN_EXPIRED":
      return "AUTH_REQUIRED";
    case "NOT_CONFIGURED":
    case "PLATFORM_APPROVAL_REQUIRED":
    case "PERMANENT_ERROR":
      return "PERMANENT_ERROR";
    default:
      return "RETRYABLE_ERROR";
  }
}

/**
 * Bounded exponential backoff: min(5min * 2^attempt, 24h).
 * attempt is the 1-based attempt count that just failed.
 */
export function computeNextRetry(attempt: number): Date {
  const safeAttempt = Math.max(0, Math.floor(attempt));
  const delayMs = Math.min(FIVE_MINUTES_MS * 2 ** safeAttempt, TWENTY_FOUR_HOURS_MS);
  return new Date(Date.now() + delayMs);
}

/** Only transient classes are retried; auth and permanent errors stop. */
export function isRetryable(c: ErrorClass): boolean {
  return c === "RETRYABLE_ERROR" || c === "RATE_LIMITED";
}
