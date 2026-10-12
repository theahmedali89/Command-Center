// Instagram provider (Graph API).
// STUB: needs a business/creator account + linked Facebook Page (NEEDS_DEV_ACCOUNT).
// Until then every mutating/credential method throws NOT_CONFIGURED and
// publish() returns an honest failure — never a fake success.

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
  id: "instagram",
  name: "Instagram",
  capabilities: ["IMAGE_POST", "VIDEO_POST", "CAROUSEL", "HASHTAGS", "ANALYTICS"],
  notes:
    "Business/Creator account + linked Facebook Page required; no link in captions.",
  docsUrl: "https://developers.facebook.com/docs/instagram-platform/",
};

function notConfigured(): never {
  // NEEDS_DEV_ACCOUNT: business/creator account + linked Page not set up yet.
  throw new Error(
    "NOT_CONFIGURED: instagram credentials not configured — NEEDS_DEV_ACCOUNT",
  );
}

export const instagramProvider: SocialProvider = {
  meta,

  getCapabilities(): Capability[] {
    return meta.capabilities;
  },

  async getAuthorizationUrl(): Promise<string> {
    notConfigured();
  },

  async handleCallback(): Promise<ConnectedAccount> {
    notConfigured();
  },

  async refreshCredentials(): Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresAt?: Date;
  }> {
    notConfigured();
  },

  async validateContent(
    content: ValidateContentInput,
  ): Promise<ValidationResult> {
    const issues: string[] = [];
    const text = [content.caption, content.description]
      .filter(Boolean)
      .join(" ");
    if (!text.trim()) issues.push("No caption text provided.");
    // Client-side sanity checks only; official limits unverified (plan rule 9).
    if (content.caption && content.caption.length > 2200) {
      issues.push(
        "Caption exceeds the 2,200-character client-side sanity limit.",
      );
    }
    if (content.hashtags && content.hashtags.length > 30) {
      issues.push("Too many hashtags (client-side sanity limit: 30).");
    }
    return { ok: issues.length === 0, issues };
  },

  async validateMedia(media: MediaItem[]): Promise<ValidationResult> {
    const issues: string[] = [];
    if (media.length === 0) issues.push("Instagram posts require media.");
    for (const m of media) {
      if (!m.mimeType.startsWith("image/") && !m.mimeType.startsWith("video/")) {
        issues.push(`Unsupported media type: ${m.mimeType}.`);
      }
      if (m.size <= 0) issues.push("A media file is empty.");
      // Client-side sanity cap; official limits unverified (plan rule 9).
      if (m.size > 4 * 1024 * 1024 * 1024) {
        issues.push("A media file exceeds the 4GB client-side sanity limit.");
      }
    }
    return { ok: issues.length === 0, issues };
  },

  async publish(_request: PublishInput): Promise<PublishResult> {
    return {
      ok: false,
      code: "NOT_CONFIGURED",
      message: "Instagram is not connected yet.",
    };
  },
};
