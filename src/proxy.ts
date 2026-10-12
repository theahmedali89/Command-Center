import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";

/**
 * Session-cookie gate for protected pages and API routes.
 *
 * NOTE on inline verification: token verification is implemented here
 * directly with jose + `process.env.SESSION_SECRET` instead of importing
 * from `@/lib/session`. proxy.ts runs at the request boundary in a
 * restricted module context and must not pull in app modules (db client,
 * audit, validated-env wrappers) — importing them would add DB/network
 * weight to every request and risks circular imports with auth code.
 * getEnv() is also avoided here: if the secret is missing, we simply
 * treat the request as unauthenticated rather than crashing the boundary.
 */
async function isAuthenticated(request: NextRequest): Promise<boolean> {
  const token = request.cookies.get("cc_session")?.value;
  if (!token) return false;

  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) return false;

  try {
    const { payload } = await jwtVerify(
      token,
      new TextEncoder().encode(secret),
    );
    return typeof payload.sub === "string";
  } catch {
    return false;
  }
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Excluded: the auth flow itself, and agent API-key routes (those use
  // API-key auth handled by their own handlers — another worker's scope).
  if (pathname.startsWith("/api/auth/") || pathname.startsWith("/api/agent/")) {
    return NextResponse.next();
  }

  const authed = await isAuthenticated(request);
  if (!authed) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { ok: false, code: "UNAUTHORIZED", message: "Not signed in" },
        { status: 401 },
      );
    }
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/sites/:path*",
    "/accounts/:path*",
    "/content/:path*",
    "/create/:path*",
    "/calendar/:path*",
    "/media/:path*",
    "/settings/:path*",
    "/logs/:path*",
    "/api/:path*",
  ],
};
