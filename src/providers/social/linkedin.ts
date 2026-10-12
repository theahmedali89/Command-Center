// LinkedIn provider (OAuth 2.0 + Share API).
// Requires a LinkedIn developer app: LINKEDIN_CLIENT_ID + LINKEDIN_CLIENT_SECRET.
// Redirect URI: {APP_URL}/api/oauth/linkedin/callback

import type { Capability, PublishResult } from "@/types";
import type {
  ConnectedAccount,
  MediaItem,
  OAuthCallbackInput,
  PlatformMeta,
  PublishInput,
  SocialProvider,
  ValidateContentInput,
  ValidationResult,
} from "./types";

const meta: PlatformMeta = {
  id: "linkedin",
  name: "LinkedIn",
  capabilities: ["TEXT_POST", "LINK", "HASHTAGS"],
  notes: "Developer app + OAuth required. Text + link posts via UGC API.",
  docsUrl: "https://learn.microsoft.com/en-us/linkedin/marketing/",
};

const AUTHORIZE_URL = "https://www.linkedin.com/oauth/v2/authorization";
const TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";
const API_BASE = "https://api.linkedin.com/v2";
// openid+profile for identity, w_member_social for posting.
const SCOPES = "openid profile w_member_social";

function appUrl(): string {
  const url = process.env.APP_URL;
  if (!url) throw new Error("NOT_CONFIGURED: set APP_URL.");
  return url.replace(/\/$/, "");
}

function appCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.LINKEDIN_CLIENT_ID;
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "NOT_CONFIGURED: set LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET (LinkedIn developer app).",
    );
  }
  return { clientId, clientSecret };
}

export const linkedinProvider: SocialProvider = {
  meta,

  getCapabilities(): Capability[] {
    return meta.capabilities;
  },

  async getAuthorizationUrl(state: string): Promise<string> {
    const { clientId } = appCredentials();
    const redirectUri = `${appUrl()}/api/oauth/linkedin/callback`;
    const url = new URL(AUTHORIZE_URL);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("scope", SCOPES);
    url.searchParams.set("state", state);
    return url.toString();
  },

  async handleCallback(input: OAuthCallbackInput): Promise<ConnectedAccount> {
    const { clientId, clientSecret } = appCredentials();
    const redirectUri = `${appUrl()}/api/oauth/linkedin/callback`;

    const tokenRes = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: input.code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
      }),
    });
    if (!tokenRes.ok) {
      const text = await tokenRes.text().catch(() => "");
      throw new Error(`LinkedIn token exchange failed (${tokenRes.status}): ${text.slice(0, 200)}`);
    }
    const token = (await tokenRes.json()) as {
      access_token?: string;
      expires_in?: number;
      scope?: string;
    };
    if (!token.access_token) {
      throw new Error("LinkedIn token exchange returned no access token.");
    }

    // Identify the member via OpenID userinfo.
    let externalAccountId = "";
    let accountName = "LinkedIn";
    try {
      const meRes = await fetch("https://api.linkedin.com/v2/userinfo", {
        headers: { Authorization: `Bearer ${token.access_token}` },
      });
      if (meRes.ok) {
        const me = (await meRes.json()) as { sub?: string; name?: string };
        externalAccountId = me.sub ?? "";
        accountName = me.name ?? "LinkedIn";
      }
    } catch {
      // Non-fatal; account still usable.
    }

    return {
      externalAccountId,
      accountName,
      accessToken: token.access_token,
      expiresAt: token.expires_in
        ? new Date(Date.now() + token.expires_in * 1000)
        : undefined,
      scopes: token.scope ?? SCOPES,
    };
  },

  async refreshCredentials(): Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresAt?: Date;
  }> {
    // LinkedIn does not issue refresh tokens for this flow; re-connect when expired.
    // The publishing engine calls this before expiry; signal re-auth needed.
    throw new Error(
      "TOKEN_REFRESH_UNSUPPORTED: LinkedIn tokens cannot be refreshed — reconnect the account.",
    );
  },

  async validateContent(
    content: ValidateContentInput,
  ): Promise<ValidationResult> {
    const issues: string[] = [];
    const text = [content.caption, content.description]
      .filter(Boolean)
      .join(" ");
    if (!text.trim()) issues.push("No post text provided.");
    if (text.length > 3000) {
      issues.push("Post text exceeds 3,000 characters.");
    }
    if (content.hashtags && content.hashtags.length > 10) {
      issues.push("Too many hashtags (limit: 10).");
    }
    return { ok: issues.length === 0, issues };
  },

  async validateMedia(media: MediaItem[]): Promise<ValidationResult> {
    // v1: text + link posts only. Images via UGC require multi-step upload;
    // reject with a clear message rather than fake success.
    if (media.length > 0) {
      return { ok: false, issues: ["LinkedIn image upload not yet supported — text/link posts only."] };
    }
    return { ok: true, issues: [] };
  },

  async publish(request: PublishInput): Promise<PublishResult> {
    const accessToken = request.accessToken;
    if (!accessToken) {
      return { ok: false, code: "NOT_CONNECTED", message: "LinkedIn account not connected." };
    }

    // Resolve the member URN (author). The publishing engine provides the
    // decrypted token; member id comes from userinfo if not cached.
    let authorUrn: string | null = null;
    // Note: externalAccountId is not on PublishInput; resolve via userinfo.
    try {
      const meRes = await fetch("https://api.linkedin.com/v2/userinfo", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!meRes.ok) {
        return { ok: false, code: "AUTH_FAILED", message: "Could not identify LinkedIn member." };
      }
      const me = (await meRes.json()) as { sub?: string };
      if (!me.sub) {
        return { ok: false, code: "AUTH_FAILED", message: "LinkedIn userinfo returned no subject." };
      }
      authorUrn = `urn:li:person:${me.sub}`;
    } catch (err) {
      return {
        ok: false,
        code: "AUTH_FAILED",
        message: err instanceof Error ? err.message : "LinkedIn auth failed.",
      };
    }

    const text = [request.caption, request.description].filter(Boolean).join("\n\n").trim();
    if (!text) {
      return { ok: false, code: "EMPTY_CONTENT", message: "No post text provided." };
    }

    // Build UGC post. Link posts: include the URL in text; LinkedIn unfurls it.
    const body = {
      author: authorUrn,
      lifecycleState: "PUBLISHED",
      specificContent: {
        "com.linkedin.ugc.ShareContent": {
          shareCommentary: { text },
          shareMediaCategory: "NONE",
        },
      },
      visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" },
    };

    try {
      const res = await fetch(`${API_BASE}/ugcPosts`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "X-Restli-Protocol-Version": "2.0.0",
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return {
          ok: false,
          code: "PUBLISH_FAILED",
          message: `LinkedIn rejected the post (${res.status}): ${text.slice(0, 300)}`,
        };
      }
      const created = (await res.json()) as { id?: string };
      return {
        ok: true,
        code: "OK",
        message: "Posted to LinkedIn.",
        externalPostId: created.id,
      };
    } catch (err) {
      return {
        ok: false,
        code: "PUBLISH_FAILED",
        message: err instanceof Error ? err.message : "LinkedIn publish failed.",
      };
    }
  },
};
