// Pinterest provider (API v5).
// STUB: needs a Pinterest developer app; publishing may need app review
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
  id: "pinterest",
  name: "Pinterest",
  capabilities: ["IMAGE_POST", "VIDEO_POST", "TITLE", "DESCRIPTION", "LINK", "SCHEDULE"],
  notes: "Developer app required; publishing may need app review.",
  docsUrl: "https://developers.pinterest.com/docs/api/v5/",
};

function notConfigured(): never {
  // NEEDS_DEV_ACCOUNT: Pinterest developer app + app review not done yet.
  throw new Error(
    "NOT_CONFIGURED: pinterest credentials not configured — NEEDS_DEV_ACCOUNT",
  );
}

export const pinterestProvider: SocialProvider = {
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
    if (!content.title?.trim()) issues.push("Pins require a title.");
    // Client-side sanity checks only; official limits unverified (plan rule 9).
    if (content.title && content.title.length > 100) {
      issues.push(
        "Title exceeds the 100-character client-side sanity limit.",
      );
    }
    if (content.description && content.description.length > 800) {
      issues.push(
        "Description exceeds the 800-character client-side sanity limit.",
      );
    }
    return { ok: issues.length === 0, issues };
  },

  async validateMedia(media: MediaItem[]): Promise<ValidationResult> {
    const issues: string[] = [];
    if (media.length === 0) issues.push("Pins require an image or video.");
    if (media.length > 1) {
      issues.push("This stub validates a single image/video per pin.");
    }
    for (const m of media) {
      if (!m.mimeType.startsWith("image/") && !m.mimeType.startsWith("video/")) {
        issues.push(`Unsupported media type: ${m.mimeType}.`);
      }
      if (m.size <= 0) issues.push("A media file is empty.");
      // Client-side sanity cap; official limits unverified (plan rule 9).
      if (m.size > 2 * 1024 * 1024 * 1024) {
        issues.push("A media file exceeds the 2GB client-side sanity limit.");
      }
    }
    return { ok: issues.length === 0, issues };
  },

  async publish(_request: PublishInput): Promise<PublishResult> {
    return {
      ok: false,
      code: "NOT_CONFIGURED",
      message: "Pinterest is not connected yet.",
    };
  },
};
