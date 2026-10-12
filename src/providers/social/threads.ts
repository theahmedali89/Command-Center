// Threads provider (official Threads API).
// STUB: needs a Threads developer app + account linkage (NEEDS_DEV_ACCOUNT).
// Until then credential methods throw NOT_CONFIGURED and publish() returns
// an honest failure — never a fake success.

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
  id: "threads",
  name: "Threads",
  capabilities: ["TEXT_POST", "IMAGE_POST", "VIDEO_POST", "HASHTAGS", "LINK"],
  notes: "Official Threads API; developer app + account linkage required.",
  docsUrl: "https://developers.facebook.com/docs/threads",
};

function notConfigured(): never {
  // NEEDS_DEV_ACCOUNT: Threads developer app not set up yet.
  throw new Error(
    "NOT_CONFIGURED: threads credentials not configured — NEEDS_DEV_ACCOUNT",
  );
}

export const threadsProvider: SocialProvider = {
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
    if (text.length > 500) {
      issues.push(
        "Post text exceeds the 500-character client-side sanity limit.",
      );
    }
    if (content.hashtags && content.hashtags.length > 10) {
      issues.push("Too many hashtags (client-side sanity limit: 10).");
    }
    return { ok: issues.length === 0, issues };
  },

  async validateMedia(media: MediaItem[]): Promise<ValidationResult> {
    const issues: string[] = [];
    if (media.length > 10) {
      issues.push("Too many media attachments (client-side sanity limit: 10).");
    }
    for (const m of media) {
      if (!m.mimeType.startsWith("image/") && !m.mimeType.startsWith("video/")) {
        issues.push(`Unsupported media type: ${m.mimeType}.`);
      }
      if (m.size <= 0) issues.push("A media file is empty.");
      // Client-side sanity cap; official limits unverified (plan rule 9).
      if (m.size > 1 * 1024 * 1024 * 1024) {
        issues.push("A media file exceeds the 1GB client-side sanity limit.");
      }
    }
    return { ok: issues.length === 0, issues };
  },

  async publish(_request: PublishInput): Promise<PublishResult> {
    return {
      ok: false,
      code: "NOT_CONFIGURED",
      message: "Threads is not connected yet.",
    };
  },
};
