// OAuth connect start: GET /api/oauth/[platform]/start
// Generates a secure random state, stores it in an httpOnly cookie, and
// redirects the user to the platform's official authorization page.
// Platforms supported in v1: facebook, youtube, pinterest, tiktok.
// NEEDS_DEV_ACCOUNT: no developer apps have been created yet — every
// client id/secret below will be missing until Ahmed sets them up, in which
// case this route answers 503 NOT_CONFIGURED (honest state, never faked).

import { randomBytes } from "crypto";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { requireApiUser } from "@/lib/session";


type OAuthPlatform = "facebook" | "youtube" | "pinterest" | "tiktok" | "linkedin";

const OAUTH_PLATFORMS: readonly OAuthPlatform[] = [
  "facebook",
  "youtube",
  "pinterest",
  "tiktok",
  "linkedin",
];

interface PlatformOAuthConfig {
  label: string;
  /** Name of the env var holding the OAuth client id/key. */
  clientIdEnv: string;
  clientId: string | undefined;
  authorizeUrl: string;
  scope: string;
  extraParams?: Record<string, string>;
}

function getPlatformConfig(platform: OAuthPlatform): PlatformOAuthConfig {
  switch (platform) {
    case "facebook":
      return {
        label: "Facebook",
        clientIdEnv: "FACEBOOK_CLIENT_ID",
        // NEEDS_DEV_ACCOUNT: Meta developer app not created yet.
        clientId: process.env.FACEBOOK_CLIENT_ID,
        // Meta OAuth dialog. Endpoint version documented; verify the current
        // version in Meta docs before wiring a real app (plan rule 9).
        authorizeUrl: "https://www.facebook.com/v21.0/dialog/oauth",
        // NEEDS_DEV_ACCOUNT: scopes must match the permissions the Meta app
        // is approved for; review in the app dashboard when creating it.
        scope: "pages_show_list,pages_read_engagement,pages_manage_posts",
      };
    case "youtube":
      return {
        label: "YouTube",
        clientIdEnv: "GOOGLE_CLIENT_ID",
        // NEEDS_DEV_ACCOUNT: Google OAuth client not created yet.
        clientId: process.env.GOOGLE_CLIENT_ID,
        authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
        // NEEDS_DEV_ACCOUNT: youtube.upload scope needs Google verification
        // for a production app; confirm in the Google Cloud console.
        scope: "https://www.googleapis.com/auth/youtube.upload",
        // offline access so the callback can store a refresh token.
        extraParams: { access_type: "offline", prompt: "consent" },
      };
    case "pinterest":
      return {
        label: "Pinterest",
        clientIdEnv: "PINTEREST_CLIENT_ID",
        // NEEDS_DEV_ACCOUNT: Pinterest developer app not created yet.
        clientId: process.env.PINTEREST_CLIENT_ID,
        authorizeUrl: "https://www.pinterest.com/oauth/",
        // NEEDS_DEV_ACCOUNT: pins:write may need app review; check the
        // Pinterest developer dashboard when creating the app.
        scope: "boards:read,pins:read,pins:write",
      };
    case "tiktok":
      return {
        label: "TikTok",
        clientIdEnv: "TIKTOK_CLIENT_KEY",
        // NEEDS_DEV_ACCOUNT: TikTok developer app not created yet.
        clientId: process.env.TIKTOK_CLIENT_KEY,
        authorizeUrl: "https://www.tiktok.com/v2/auth/authorize/",
        // NEEDS_DEV_ACCOUNT: the Content Posting API needs app audit
        // approval before these scopes can publish.
        scope: "user.info.basic,video.upload",
      };
    case "linkedin":
      return {
        label: "LinkedIn",
        clientIdEnv: "LINKEDIN_CLIENT_ID",
        clientId: process.env.LINKEDIN_CLIENT_ID,
        authorizeUrl: "https://www.linkedin.com/oauth/v2/authorization",
        scope: "openid profile w_member_social",
      };
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ platform: string }> },
): Promise<Response> {
  // requireApiUser() throws a 401 Response when unauthenticated; returning a
  // thrown Response is not guaranteed across Next versions, so catch it.
  try {
    await requireApiUser();
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }

  const { platform } = await params;
  if (
    !platform ||
    !(OAUTH_PLATFORMS as readonly string[]).includes(platform)
  ) {
    return NextResponse.json(
      {
        ok: false,
        code: "INVALID_PLATFORM",
        message:
          "Unsupported platform for OAuth. Supported: facebook, youtube, pinterest, tiktok, linkedin.",
      },
      { status: 400 },
    );
  }

  const config = getPlatformConfig(platform as OAuthPlatform);

  if (!config.clientId) {
    return NextResponse.json(
      {
        ok: false,
        code: "NOT_CONFIGURED",
        message: `${config.label} OAuth is not configured yet — set ${config.clientIdEnv} (developer app setup pending).`,
      },
      { status: 503 },
    );
  }

  // The public app URL registered as the OAuth redirect base in each dev app.
  // Falls back to the request origin when APP_URL is not set.
  const appUrl = (process.env.APP_URL ?? request.nextUrl.origin).replace(/\/$/, "");
  const redirectUri = `${appUrl}/api/oauth/${platform}/callback`;

  const state = randomBytes(32).toString("hex");

  const authUrl = new URL(config.authorizeUrl);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", config.clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", config.scope);
  authUrl.searchParams.set("state", state);
  if (config.extraParams) {
    for (const [key, value] of Object.entries(config.extraParams)) {
      authUrl.searchParams.set(key, value);
    }
  }

  const response = NextResponse.redirect(authUrl);

  // Bind the state to this browser session: verified by the callback route.
  const cookieStore = await cookies();
  cookieStore.set("cc_oauth_state", JSON.stringify({ platform, state }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 10, // 10 minutes
  });

  return response;
}
