// YouTube provider (Data API v3).
// STUB: needs Google OAuth consent + channel linkage (NEEDS_DEV_ACCOUNT).
// Quota must be verified, not assumed (see plan §8). Until then every
// mutating/credential method throws NOT_CONFIGURED and publish() returns an
// honest failure — never a fake success.

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
  id: "youtube",
  name: "YouTube",
  capabilities: [
    "VIDEO_POST",
    "SHORT_VIDEO",
    "TITLE",
    "DESCRIPTION",
    "TAGS",
    "THUMBNAIL",
    "SCHEDULE",
    "ANALYTICS",
  ],
  notes: "OAuth; quota to be verified, not assumed.",
  docsUrl: "https://developers.google.com/youtube/v3",
};

function notConfigured(): never {
  // NEEDS_DEV_ACCOUNT: Google OAuth client + channel linkage not set up yet.
  throw new Error(
    "NOT_CONFIGURED: youtube credentials not configured — NEEDS_DEV_ACCOUNT",
  );
}

export const youtubeProvider: SocialProvider = {
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
    if (!content.title?.trim()) issues.push("YouTube uploads require a title.");
    if (!content.description?.trim()) {
      issues.push("YouTube uploads require a description.");
    }
    // Client-side sanity checks only; official limits unverified (plan rule 9).
    if (content.title && content.title.length > 100) {
      issues.push(
        "Title exceeds the 100-character client-side sanity limit.",
      );
    }
    if (content.description && content.description.length > 5000) {
      issues.push(
        "Description exceeds the 5,000-character client-side sanity limit.",
      );
    }
    if (content.hashtags && content.hashtags.length > 15) {
      issues.push("Too many tags (client-side sanity limit: 15).");
    }
    return { ok: issues.length === 0, issues };
  },

  async validateMedia(media: MediaItem[]): Promise<ValidationResult> {
    const issues: string[] = [];
    if (media.length === 0) issues.push("YouTube uploads require a video file.");
    if (media.length > 1) {
      issues.push("YouTube accepts one video per upload.");
    }
    for (const m of media) {
      if (!m.mimeType.startsWith("video/")) {
        issues.push(`Unsupported media type for YouTube: ${m.mimeType}.`);
      }
      if (m.size <= 0) issues.push("The video file is empty.");
      // Client-side sanity cap; official limits unverified (plan rule 9).
      if (m.size > 256 * 1024 * 1024 * 1024) {
        issues.push("The video exceeds the 256GB client-side sanity limit.");
      }
    }
    return { ok: issues.length === 0, issues };
  },

  async publish(_request: PublishInput): Promise<PublishResult> {
    return {
      ok: false,
      code: "NOT_CONFIGURED",
      message: "YouTube is not connected yet.",
    };
  },
};
