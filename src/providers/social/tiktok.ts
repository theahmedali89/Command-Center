// TikTok provider (Content Posting API).
// STUB: publishing needs an approved TikTok developer app — the Content
// Posting API requires app audit approval (NEEDS_DEV_ACCOUNT). Until approval
// lands, credential methods throw NOT_CONFIGURED and publish() returns
// PLATFORM_APPROVAL_REQUIRED — never a fake success.

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
  id: "tiktok",
  name: "TikTok",
  capabilities: ["SHORT_VIDEO", "HASHTAGS", "TITLE"],
  notes: "Content Posting API needs app audit approval.",
  docsUrl: "https://developers.tiktok.com/doc/content-posting-api-get-started/",
};

function notConfigured(): never {
  // NEEDS_DEV_ACCOUNT: TikTok developer app + audit approval not done yet.
  throw new Error(
    "NOT_CONFIGURED: tiktok credentials not configured — NEEDS_DEV_ACCOUNT",
  );
}

export const tiktokProvider: SocialProvider = {
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
    // Client-side sanity checks only; official limits unverified (plan rule 9).
    if (content.title && content.title.length > 2200) {
      issues.push(
        "Title exceeds the 2,200-character client-side sanity limit.",
      );
    }
    if (content.hashtags && content.hashtags.length > 30) {
      issues.push("Too many hashtags (client-side sanity limit: 30).");
    }
    return { ok: issues.length === 0, issues };
  },

  async validateMedia(media: MediaItem[]): Promise<ValidationResult> {
    const issues: string[] = [];
    if (media.length === 0) issues.push("TikTok posts require a video file.");
    if (media.length > 1) {
      issues.push("This stub validates a single short video per post.");
    }
    for (const m of media) {
      if (!m.mimeType.startsWith("video/")) {
        issues.push(`Unsupported media type for TikTok: ${m.mimeType}.`);
      }
      if (m.size <= 0) issues.push("The video file is empty.");
      // Client-side sanity cap; official limits unverified (plan rule 9).
      if (m.size > 4 * 1024 * 1024 * 1024) {
        issues.push("The video exceeds the 4GB client-side sanity limit.");
      }
    }
    return { ok: issues.length === 0, issues };
  },

  async publish(_request: PublishInput): Promise<PublishResult> {
    return {
      ok: false,
      code: "PLATFORM_APPROVAL_REQUIRED",
      message:
        "TikTok is not connected yet — the Content Posting API needs app audit approval before publishing is possible.",
    };
  },
};
