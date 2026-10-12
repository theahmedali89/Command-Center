// Telegram provider (Bot API).
// STUB: channel posting via a bot token (BotFather); setup takes ~15 min
// (plan §8) but is not done yet (NEEDS_DEV_ACCOUNT). Until then credential
// methods throw NOT_CONFIGURED and publish() returns an honest failure —
// never a fake success.

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
  id: "telegram",
  name: "Telegram",
  capabilities: ["TEXT_POST", "IMAGE_POST", "VIDEO_POST", "LINK"],
  notes: "Bot API; channel posting via bot token.",
  docsUrl: "https://core.telegram.org/bots/api",
};

function notConfigured(): never {
  // NEEDS_DEV_ACCOUNT: Telegram bot token + channel not set up yet.
  throw new Error(
    "NOT_CONFIGURED: telegram credentials not configured — NEEDS_DEV_ACCOUNT",
  );
}

export const telegramProvider: SocialProvider = {
  meta,

  getCapabilities(): Capability[] {
    return meta.capabilities;
  },

  async getAuthorizationUrl(): Promise<string> {
    // Telegram uses a bot token, not OAuth — still not configured.
    notConfigured();
  },

  async handleCallback(): Promise<ConnectedAccount> {
    // Telegram uses a bot token, not OAuth — still not configured.
    notConfigured();
  },

  async refreshCredentials(): Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresAt?: Date;
  }> {
    // Bot tokens do not expire; there is simply no token configured yet.
    notConfigured();
  },

  async validateContent(
    content: ValidateContentInput,
  ): Promise<ValidationResult> {
    const issues: string[] = [];
    const text = [content.caption, content.description]
      .filter(Boolean)
      .join(" ");
    if (!text.trim()) issues.push("No message text provided.");
    // Client-side sanity check only; official limits unverified (plan rule 9).
    if (text.length > 4096) {
      issues.push(
        "Message text exceeds the 4,096-character client-side sanity limit.",
      );
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
      message: "Telegram is not connected yet.",
    };
  },
};
