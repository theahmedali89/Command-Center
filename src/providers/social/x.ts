// X (Twitter) provider (official API).
// STUB: free-tier limits must be verified before promising volume (plan §8)
// (NEEDS_DEV_ACCOUNT). Until then credential methods throw NOT_CONFIGURED
// and publish() returns an honest failure — never a fake success.

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
  id: "x",
  name: "X",
  capabilities: [
    "TEXT_POST",
    "IMAGE_POST",
    "VIDEO_POST",
    "HASHTAGS",
    "LINK",
    "SCHEDULE",
    "ANALYTICS",
  ],
  notes: "Free-tier limits must be verified.",
  docsUrl: "https://docs.x.com/",
};

function notConfigured(): never {
  // NEEDS_DEV_ACCOUNT: X developer app not set up yet.
  throw new Error(
    "NOT_CONFIGURED: x credentials not configured — NEEDS_DEV_ACCOUNT",
  );
}

export const xProvider: SocialProvider = {
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
    if (!text.trim()) issues.push("No post text provided.");
    // Client-side sanity checks only; official limits unverified (plan rule 9).
    if (text.length > 280) {
      issues.push(
        "Post text exceeds the 280-character client-side sanity limit.",
      );
    }
    if (content.hashtags && content.hashtags.length > 10) {
      issues.push("Too many hashtags (client-side sanity limit: 10).");
    }
    return { ok: issues.length === 0, issues };
  },

  async validateMedia(media: MediaItem[]): Promise<ValidationResult> {
    const issues: string[] = [];
    if (media.length > 4) {
      issues.push("Too many media attachments (client-side sanity limit: 4).");
    }
    for (const m of media) {
      if (!m.mimeType.startsWith("image/") && !m.mimeType.startsWith("video/")) {
        issues.push(`Unsupported media type: ${m.mimeType}.`);
      }
      if (m.size <= 0) issues.push("A media file is empty.");
      // Client-side sanity cap; official limits unverified (plan rule 9).
      if (m.size > 512 * 1024 * 1024) {
        issues.push("A media file exceeds the 512MB client-side sanity limit.");
      }
    }
    return { ok: issues.length === 0, issues };
  },

  async publish(_request: PublishInput): Promise<PublishResult> {
    return {
      ok: false,
      code: "NOT_CONFIGURED",
      message: "X is not connected yet.",
    };
  },
};
