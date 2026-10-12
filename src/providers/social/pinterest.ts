// Pinterest provider (API v5) — real implementation.
// OAuth:  https://www.pinterest.com/oauth/ (code) →
//         POST https://api.pinterest.com/v5/oauth/token (Basic app id:secret)
// Pins:   POST https://api.pinterest.com/v5/pins (Bearer token)
// Boards: GET  https://api.pinterest.com/v5/boards
// Refresh: POST https://api.pinterest.com/v5/oauth/token (grant_type=refresh_token)
// Docs: https://developers.pinterest.com/docs/api/v5/
//
// NOTE: new Pinterest apps start in Trial mode — pins are visible only to
// the creator until Pinterest approves Standard access (app review).

import type { Capability, PublishResult } from "@/types";
import { decryptSecret } from "@/lib/crypto";
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

const API_BASE = "https://api.pinterest.com/v5";
const AUTHORIZE_URL = "https://www.pinterest.com/oauth/";
const SCOPES = "boards:read,pins:read,pins:write";

const meta: PlatformMeta = {
  id: "pinterest",
  name: "Pinterest",
  capabilities: ["IMAGE_POST", "TITLE", "DESCRIPTION", "LINK"],
  notes:
    "Pinterest API v5. New apps start in Trial mode (pins visible only to you) until Pinterest approves Standard access.",
  docsUrl: "https://developers.pinterest.com/docs/api/v5/",
};

function appCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.PINTEREST_CLIENT_ID;
  const clientSecret = process.env.PINTEREST_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "NOT_CONFIGURED: set PINTEREST_CLIENT_ID and PINTEREST_CLIENT_SECRET (Pinterest developer app).",
    );
  }
  return { clientId, clientSecret };
}

function basicAuth(clientId: string, clientSecret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
}

function appUrl(): string {
  const url = process.env.APP_URL;
  if (!url) {
    throw new Error(
      "NOT_CONFIGURED: set APP_URL to the public app URL (used as the OAuth redirect base).",
    );
  }
  return url.replace(/\/$/, "");
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  message?: string;
}

async function exchangeToken(
  params: Record<string, string>,
): Promise<{ accessToken: string; refreshToken?: string; expiresAt?: Date; scopes?: string }> {
  const { clientId, clientSecret } = appCredentials();
  const res = await fetch(`${API_BASE}/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: basicAuth(clientId, clientSecret),
    },
    body: new URLSearchParams(params),
  });
  const data = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || !data.access_token) {
    // Never leak provider internals; keep the failure code machine-readable.
    throw new Error(`TOKEN_EXCHANGE_FAILED: ${res.status}`);
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: data.expires_in
      ? new Date(Date.now() + data.expires_in * 1000)
      : undefined,
    scopes: data.scope,
  };
}

export interface PinterestBoard {
  id: string;
  name: string;
  privacy: string;
}

/** List all boards for the account (follows pagination). Exported for the boards API route. */
export async function listBoards(accessToken: string): Promise<PinterestBoard[]> {
  const boards: PinterestBoard[] = [];
  let bookmark: string | null = null;
  for (let page = 0; page < 20; page++) {
    const url = new URL(`${API_BASE}/boards`);
    url.searchParams.set("page_size", "250");
    if (bookmark) url.searchParams.set("bookmark", bookmark);
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.status === 401) throw new Error("AUTH_REQUIRED");
    if (!res.ok) throw new Error(`BOARDS_FAILED: ${res.status}`);
    const data = (await res.json()) as {
      items?: { id?: string; name?: string; privacy?: string }[];
      bookmark?: string | null;
    };
    for (const item of data.items ?? []) {
      if (item.id && item.name) {
        boards.push({
          id: item.id,
          name: item.name,
          privacy: item.privacy ?? "UNKNOWN",
        });
      }
    }
    bookmark = data.bookmark ?? null;
    if (!bookmark) break;
  }
  return boards;
}

export const pinterestProvider: SocialProvider = {
  meta,

  getCapabilities(): Capability[] {
    return meta.capabilities;
  },

  async getAuthorizationUrl(state: string): Promise<string> {
    const { clientId } = appCredentials();
    const redirectUri = `${appUrl()}/api/oauth/pinterest/callback`;
    const url = new URL(AUTHORIZE_URL);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("scope", SCOPES);
    url.searchParams.set("state", state);
    return url.toString();
  },

  async handleCallback(input: OAuthCallbackInput): Promise<ConnectedAccount> {
    const redirectUri = `${appUrl()}/api/oauth/pinterest/callback`;
    const token = await exchangeToken({
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: redirectUri,
    });
    // Identify the account so the UI can show who connected.
    const meRes = await fetch(`${API_BASE}/user_account`, {
      headers: { Authorization: `Bearer ${token.accessToken}` },
    });
    let externalAccountId = "";
    let accountName = "Pinterest";
    if (meRes.ok) {
      const me = (await meRes.json()) as { id?: string; username?: string };
      externalAccountId = me.id ?? "";
      accountName = me.username ? `@${me.username}` : "Pinterest";
    }
    return {
      externalAccountId,
      accountName,
      accessToken: token.accessToken,
      refreshToken: token.refreshToken,
      expiresAt: token.expiresAt,
      scopes: token.scopes,
    };
  },

  async refreshCredentials(account: {
    encryptedAccessToken?: string | null;
    encryptedRefreshToken?: string | null;
  }): Promise<{ accessToken: string; refreshToken?: string; expiresAt?: Date }> {
    if (!account.encryptedRefreshToken) {
      throw new Error("AUTH_REQUIRED: no refresh token stored — reconnect Pinterest.");
    }
    let refreshToken: string;
    try {
      refreshToken = decryptSecret(account.encryptedRefreshToken);
    } catch {
      throw new Error("AUTH_REQUIRED: stored refresh token could not be decrypted.");
    }
    return exchangeToken({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    });
  },

  async validateContent(content: ValidateContentInput): Promise<ValidationResult> {
    const issues: string[] = [];
    if (!content.title?.trim() && !content.caption?.trim()) {
      issues.push("Pins need a title.");
    }
    if (content.title && content.title.length > 100) {
      issues.push("Title exceeds Pinterest's 100-character limit (it will be truncated).");
    }
    if (content.description && content.description.length > 500) {
      issues.push("Description exceeds Pinterest's 500-character limit (it will be truncated).");
    }
    return { ok: issues.length === 0, issues };
  },

  async validateMedia(media: MediaItem[]): Promise<ValidationResult> {
    const issues: string[] = [];
    if (media.length === 0) issues.push("Pins require an image.");
    if (media.length > 1) {
      issues.push("Only the first image is used for a pin.");
    }
    for (const m of media) {
      if (!m.mimeType.startsWith("image/")) {
        issues.push(`Unsupported media type for Pinterest: ${m.mimeType}.`);
      }
      if (m.size > 32 * 1024 * 1024) {
        issues.push("Image exceeds Pinterest's 32MB limit.");
      }
    }
    return { ok: issues.length === 0, issues };
  },

  async publish(request: PublishInput): Promise<PublishResult> {
    if (!request.accessToken) {
      return {
        ok: false,
        code: "AUTH_REQUIRED",
        message: "Pinterest is not connected.",
      };
    }
    if (!request.boardId) {
      return {
        ok: false,
        code: "BOARD_REQUIRED",
        message: "No Pinterest board selected — choose a default board in Accounts.",
      };
    }
    const imageUrl = request.mediaUrls?.[0];
    if (!imageUrl) {
      return {
        ok: false,
        code: "MEDIA_REQUIRED",
        message: "Pinterest pins require an image.",
      };
    }

    // Pinterest platform limits — truncate rather than fail the pin.
    const title = (request.title ?? request.caption ?? "").trim().slice(0, 100);
    const description = [
      request.description,
      request.caption,
      (request.hashtags ?? [])
        .map((h) => (h.startsWith("#") ? h : `#${h}`))
        .join(" "),
    ]
      .filter(Boolean)
      .join("\n\n")
      .slice(0, 500);

    let res: Response;
    try {
      res = await fetch(`${API_BASE}/pins`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${request.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          board_id: request.boardId,
          title: title || undefined,
          description: description || undefined,
          link: request.link || undefined,
          media_source: { source_type: "image_url", url: imageUrl },
        }),
      });
    } catch {
      return {
        ok: false,
        code: "NETWORK_ERROR",
        message: "Could not reach the Pinterest API.",
      };
    }

    if (res.status === 401) {
      return {
        ok: false,
        code: "AUTH_REQUIRED",
        message: "Pinterest token expired or revoked — reconnect the account.",
      };
    }
    if (res.status === 429) {
      return {
        ok: false,
        code: "RATE_LIMITED",
        message: "Pinterest rate limit hit — will retry later.",
      };
    }
    const data = (await res.json().catch(() => ({}))) as {
      id?: string;
      message?: string;
    };
    if (!res.ok || !data.id) {
      return {
        ok: false,
        code: "PINTEREST_ERROR",
        message: data.message
          ? `Pinterest refused the pin: ${data.message}`.slice(0, 300)
          : `Pinterest returned HTTP ${res.status}.`,
      };
    }
    return {
      ok: true,
      message: "Pin published.",
      externalPostId: data.id,
      externalUrl: `https://www.pinterest.com/pin/${data.id}/`,
    };
  },
};
