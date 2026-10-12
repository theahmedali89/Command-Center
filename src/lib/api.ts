/**
 * Shared JSON response helpers for API routes.
 * Every route answers in the ApiResponse shape: { ok: true, data } or
 * { ok: false, code, message }. Secrets must never appear in responses.
 */
import { NextResponse } from "next/server";
import type { z } from "zod";

export function ok<T>(data: T, status = 200): NextResponse {
  return NextResponse.json({ ok: true, data }, { status });
}

export function fail(code: string, message: string, status = 400): NextResponse {
  return NextResponse.json({ ok: false, code, message }, { status });
}

/** Turn a Zod safeParse failure into a 400 VALIDATION_ERROR response. */
export function validationError(error: z.ZodError): NextResponse {
  const message = error.issues
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
  return fail("VALIDATION_ERROR", message, 400);
}

/** Fallback for unexpected failures — never leaks internals. */
export function unexpectedError(operation: string): NextResponse {
  console.error(`[api] ${operation} failed unexpectedly`);
  return fail("INTERNAL_ERROR", `Something went wrong while ${operation}.`, 500);
}

/** Prisma unique-constraint violation check (e.g. idempotencyKey collisions). */
export function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "P2002"
  );
}

/**
 * Detect an auth failure thrown by requireApiUser (another worker owns it,
 * so accept every plausible throw shape) and turn it into a 401 response.
 * Returns null when the error is not auth-related.
 */
export function authFailureResponse(err: unknown): Response | null {
  if (err instanceof Response) {
    if (err.status === 401 || err.status === 403) return err;
    return null;
  }
  if (typeof err === "object" && err !== null) {
    const rec = err as Record<string, unknown>;
    const status = rec.status ?? rec.statusCode;
    if (status === 401 || status === 403) {
      return fail("UNAUTHORIZED", "Sign in required.", 401);
    }
    const message = typeof rec.message === "string" ? rec.message : "";
    if (/unauthori[sz]ed|not signed in|401/i.test(message)) {
      return fail("UNAUTHORIZED", "Sign in required.", 401);
    }
  }
  return null;
}
