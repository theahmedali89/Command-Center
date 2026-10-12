// OAuth callback: GET /api/oauth/[platform]/callback
// Verifies the state cookie, exchanges the authorization code at the
// platform's token endpoint, encrypts the tokens, and upserts the
// SocialAccount row as CONNECTED (or APPROVAL_REQUIRED when the provider
// indicates approval is pending). Then redirects to /accounts.
// NEEDS_DEV_ACCOUNT: token endpoints are documented below but no developer
// apps exist yet — verify endpoint URLs + versions in official docs before
// wiring real credentials (plan rule 9). Secrets are never logged.

import { timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { requireApiUser } from "@/lib/session";
import { db } from "@/lib/db";
import { audit, AuditActions } from "@/lib/audit";
import { encryptSecret } from "@/lib/crypto";
import { ConnectionStatus } from "@/types";


type OAuthPlatform = "facebook" | "youtube" | "pinterest" | "tiktok" | "linkedin";

const OAUTH_PLATFORMS: readonly OAuthPlatform[] = [
  "facebook",
  "youtube",
  "pinterest",
  "tiktok",
  "linkedin",
];

interface TokenResult {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  scopes?: string;
  /** Raw provider response (for approval-pending signals); never logged. */
  raw: unknown;
}

function fail(request: NextRequest, errorCode: string): NextResponse {
  const url = new URL("/accounts", request.url);
  url.searchParams.set("error", errorCode);
  const res = NextResponse.redirect(url);
  res.cookies.delete("cc_oauth_state");
  return res;
}

/**
 * Exchange the authorization code at the platform's token endpoint.
 * Endpoint URLs are documented per platform; each is marked NEEDS_DEV_ACCOUNT
 * because no developer apps exist yet and versions must be re-verified
 * against official docs before production use (plan rule 9).
 */
async function exchangeCode(
  platform: OAuthPlatform,
  code: string,
  redirectUri: string,
): Promise<TokenResult> {
  switch (platform) {
    case "facebook": {
      // Token endpoint: https://graph.facebook.com/v21.0/oauth/access_token
      // (NEEDS_DEV_ACCOUNT: verify the current Graph API version).
      // Facebook returns a short-lived token here; the long-lived exchange is
      // a separate call and is left for the full implementation.
      const clientId = process.env.FACEBOOK_CLIENT_ID;
      const clientSecret = process.env.FACEBOOK_CLIENT_SECRET;
      if (!clientId || !clientSecret) throw new Error("NOT_CONFIGURED");
      const tokenUrl = new URL(
        "https://graph.facebook.com/v21.0/oauth/access_token",
      );
      tokenUrl.searchParams.set("client_id", clientId);
      tokenUrl.searchParams.set("client_secret", clientSecret);
      tokenUrl.searchParams.set("redirect_uri", redirectUri);
      tokenUrl.searchParams.set("code", code);
      const res = await fetch(tokenUrl, { method: "POST" });
      if (!res.ok) throw new Error("TOKEN_EXCHANGE_FAILED");
      const data = (await res.json()) as {
        access_token?: string;
        expires_in?: number;
      };
      if (!data.access_token) throw new Error("TOKEN_EXCHANGE_FAILED");
      return {
        accessToken: data.access_token,
        expiresIn: data.expires_in,
        raw: data,
      };
    }
    case "youtube": {
      // Token endpoint: https://oauth2.googleapis.com/token
      // (NEEDS_DEV_ACCOUNT: verify against Google OAuth2 docs).
      const clientId = process.env.GOOGLE_CLIENT_ID;
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
      if (!clientId || !clientSecret) throw new Error("NOT_CONFIGURED");
      const res = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        }),
      });
      if (!res.ok) throw new Error("TOKEN_EXCHANGE_FAILED");
      const data = (await res.json()) as {
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
        scope?: string;
      };
      if (!data.access_token) throw new Error("TOKEN_EXCHANGE_FAILED");
      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresIn: data.expires_in,
        scopes: data.scope,
        raw: data,
      };
    }
    case "pinterest": {
      // Token endpoint: https://api.pinterest.com/v5/oauth/token
      // (NEEDS_DEV_ACCOUNT: verify against Pinterest API v5 docs).
      // Pinterest uses HTTP Basic auth with the app id:secret.
      const clientId = process.env.PINTEREST_CLIENT_ID;
      const clientSecret = process.env.PINTEREST_CLIENT_SECRET;
      if (!clientId || !clientSecret) throw new Error("NOT_CONFIGURED");
      const res = await fetch("https://api.pinterest.com/v5/oauth/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
        }),
      });
      if (!res.ok) throw new Error("TOKEN_EXCHANGE_FAILED");
      const data = (await res.json()) as {
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
        scope?: string;
      };
      if (!data.access_token) throw new Error("TOKEN_EXCHANGE_FAILED");
      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresIn: data.expires_in,
        scopes: data.scope,
        raw: data,
      };
    }
    case "tiktok": {
      // Token endpoint: https://open.tiktokapis.com/v2/oauth/token/
      // (NEEDS_DEV_ACCOUNT: verify against TikTok developer docs).
      // NOTE: the Content Posting API needs app audit approval; if the token
      // response (or the app dashboard) indicates approval is pending, the
      // account is stored as APPROVAL_REQUIRED below.
      const clientKey = process.env.TIKTOK_CLIENT_KEY;
      const clientSecret = process.env.TIKTOK_CLIENT_SECRET;
      if (!clientKey || !clientSecret) throw new Error("NOT_CONFIGURED");
      const res = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_key: clientKey,
          client_secret: clientSecret,
          code,
          grant_type: "authorization_code",
          redirect_uri: redirectUri,
        }),
      });
      if (!res.ok) throw new Error("TOKEN_EXCHANGE_FAILED");
      const data = (await res.json()) as {
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
        scope?: string;
      };
      if (!data.access_token) throw new Error("TOKEN_EXCHANGE_FAILED");
      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresIn: data.expires_in,
        scopes: data.scope,
        raw: data,
      };
    }
    case "linkedin": {
      const clientId = process.env.LINKEDIN_CLIENT_ID;
      const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
      if (!clientId || !clientSecret) throw new Error("NOT_CONFIGURED");
      const res = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
        }),
      });
      if (!res.ok) throw new Error("TOKEN_EXCHANGE_FAILED");
      const data = (await res.json()) as {
        access_token?: string;
        expires_in?: number;
        scope?: string;
      };
      if (!data.access_token) throw new Error("TOKEN_EXCHANGE_FAILED");
      return {
        accessToken: data.access_token,
        expiresIn: data.expires_in,
        scopes: data.scope,
        raw: data,
      };
    }
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ platform: string }> },
): Promise<Response> {
  let user: { id: string };
  try {
    user = await requireApiUser();
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }

  const { platform } = await params;
  const url = request.nextUrl;

  // The platform denied the grant (user cancelled or app issue).
  if (url.searchParams.get("error")) return fail(request, "oauth_denied");

  if (
    !platform ||
    !(OAUTH_PLATFORMS as readonly string[]).includes(platform)
  ) {
    return fail(request, "invalid_platform");
  }
  const oauthPlatform = platform as OAuthPlatform;

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return fail(request, "invalid_state");

  // Verify the state against the httpOnly cookie set by the start route.
  const cookieStore = await cookies();
  const stored = cookieStore.get("cc_oauth_state")?.value;
  let parsed: { platform?: string; state?: string } | null = null;
  try {
    parsed = stored ? (JSON.parse(stored) as { platform?: string; state?: string }) : null;
  } catch {
    parsed = null;
  }
  if (!parsed || parsed.platform !== oauthPlatform || !parsed.state) {
    return fail(request, "invalid_state");
  }
  const a = Buffer.from(state);
  const b = Buffer.from(parsed.state);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return fail(request, "invalid_state");
  }

  const appUrl = (process.env.APP_URL ?? request.nextUrl.origin).replace(/\/$/, "");
  const redirectUri = `${appUrl}/api/oauth/${oauthPlatform}/callback`;

  let token: TokenResult;
  try {
    token = await exchangeCode(oauthPlatform, code, redirectUri);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    if (message === "NOT_CONFIGURED") return fail(request, "not_configured");
    // Never leak provider error details into the redirect URL.
    return fail(request, "oauth_failed");
  }

  // A successful token exchange proves the credentials work: CONNECTED.
  // Some providers signal a pending approval in the token response — map that
  // to APPROVAL_REQUIRED instead (honest state, plan §2).
  const approvalPending =
    typeof token.raw === "object" &&
    token.raw !== null &&
    (token.raw as { approval_pending?: unknown }).approval_pending === true;
  const status: ConnectionStatus = approvalPending
    ? ConnectionStatus.APPROVAL_REQUIRED
    : ConnectionStatus.CONNECTED;

  const encryptedAccessToken = encryptSecret(token.accessToken);
  const encryptedRefreshToken = token.refreshToken
    ? encryptSecret(token.refreshToken)
    : null;
  const tokenExpiresAt = token.expiresIn
    ? new Date(Date.now() + token.expiresIn * 1000)
    : null;

  const existing = await db.socialAccount.findFirst({
    where: { userId: user.id, platform: oauthPlatform },
  });
  const account = existing
    ? await db.socialAccount.update({
        where: { id: existing.id },
        data: {
          encryptedAccessToken,
          encryptedRefreshToken,
          tokenExpiresAt,
          scopes: token.scopes ?? null,
          connectionStatus: status,
          lastVerifiedAt: new Date(),
          lastError: null,
        },
      })
    : await db.socialAccount.create({
        data: {
          userId: user.id,
          platform: oauthPlatform,
          encryptedAccessToken,
          encryptedRefreshToken,
          tokenExpiresAt,
          scopes: token.scopes ?? null,
          connectionStatus: status,
          lastVerifiedAt: new Date(),
        },
      });

  // NOTE (NEEDS_DEV_ACCOUNT): fetching the account name / external id from the
  // platform's profile endpoint is platform-specific and is wired when real
  // app credentials exist. Until then accountName stays null.

  await audit({
    userId: user.id,
    actorType: "USER",
    actorId: user.id,
    action: AuditActions.ACCOUNT_CONNECTED,
    entityType: "SocialAccount",
    entityId: account.id,
    platform: oauthPlatform,
    safeMetadata: { scopes: token.scopes ?? null, status },
  });

  const res = NextResponse.redirect(new URL("/accounts", request.url));
  res.cookies.delete("cc_oauth_state");
  return res;
}
