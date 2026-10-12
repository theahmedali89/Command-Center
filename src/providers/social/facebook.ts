// Facebook Pages provider (Graph API).
// STUB: real implementation needs a Meta developer app + Page (NEEDS_DEV_ACCOUNT).
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
  id: "facebook",
  name: "Facebook",
  capabilities: [
    "TEXT_POST",
    "IMAGE_POST",
    "VIDEO_POST",
    "LINK",
    "SCHEDULE",
    "ANALYTICS",
  ],
  notes: "Needs Meta developer app + Page; personal-profile posting not assumed.",
  docsUrl: "https://developers.facebook.com/docs/pages-api/",
};

function notConfigured(): never {
  // NEEDS_DEV_ACCOUNT: Meta developer app + Facebook Page not set up yet.
  throw new Error(
    "NOT_CONFIGURED: facebook credentials not configured — NEEDS_DEV_ACCOUNT",
  );
}

export const facebookProvider: SocialProvider = {
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
    const text = [content.title, content.caption, content.description]
      .filter(Boolean)
      .join(" ");
    if (!text.trim()) issues.push("No text content provided.");
    // Client-side sanity check only; official limits unverified (plan rule 9).
    if (content.caption && content.caption.length > 5000) {
      issues.push(
        "Caption exceeds the 5,000-character client-side sanity limit.",
      );
    }
    if (content.hashtags && content.hashtags.length > 30) {
      issues.push("Too many hashtags (client-side sanity limit: 30).");
    }
    return { ok: issues.length === 0, issues };
  },

  async validateMedia(media: MediaItem[]): Promise<ValidationResult> {
    const issues: string[] = [];
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
      message: "Facebook is not connected yet.",
    };
  },
};
