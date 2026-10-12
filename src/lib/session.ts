import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import { getEnv } from "./env";
import { db } from "./db";

const COOKIE_NAME = "cc_session";
const SESSION_TTL = "7d";

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
}

function secretKey(): Uint8Array {
  return new TextEncoder().encode(getEnv().SESSION_SECRET);
}

/** Create a signed session and set the cookie. Call inside a route handler / server action. */
export async function createSession(user: {
  id: string;
  email: string;
  name: string | null;
}): Promise<void> {
  const token = await new SignJWT({ userId: user.id, email: user.email })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(SESSION_TTL)
    .sign(secretKey());
  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
}

/**
 * Return the current session user, or null. Verifies the JWT signature and
 * re-validates the user against the database. Never throws.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  try {
    const store = await cookies();
    const token = store.get(COOKIE_NAME)?.value;
    if (!token) return null;
    const { payload } = await jwtVerify(token, secretKey());
    const userId = payload.userId;
    if (typeof userId !== "string") return null;
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true },
    });
    return user;
  } catch {
    return null;
  }
}

/** For server components/pages: redirect to /login when unauthenticated. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

/**
 * For API route handlers: throws a 401 Response when unauthenticated.
 * Call at the top of the handler: `const user = await requireApiUser();`
 */
export async function requireApiUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) {
    throw new Response(
      JSON.stringify({
        ok: false,
        code: "UNAUTHORIZED",
        message: "Not signed in.",
      }),
      { status: 401, headers: { "content-type": "application/json" } }
    );
  }
  return user;
}

/** Delete the session cookie. */
export async function destroySession(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}
