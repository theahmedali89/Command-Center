// Shared domain types for Command Center.
// Prisma enums are re-exported as values; everything else is plain TS.
// Workers: import from "@/types". Do NOT duplicate these definitions.

export {
  ActorType,
  ConnectionStatus,
  PublishStatus,
  CampaignStatus,
} from "@prisma/client";

export const PLATFORMS = [
  "facebook",
  "instagram",
  "youtube",
  "tiktok",
  "pinterest",
  "x",
  "threads",
  "telegram",
  "tumblr",
  "bluesky",
  "linkedin",
  "wordpress",
] as const;
export type PlatformId = (typeof PLATFORMS)[number];

export const CAPABILITIES = [
  "TEXT_POST",
  "IMAGE_POST",
  "VIDEO_POST",
  "SHORT_VIDEO",
  "CAROUSEL",
  "TITLE",
  "DESCRIPTION",
  "HASHTAGS",
  "TAGS",
  "LINK",
  "SCHEDULE",
  "ANALYTICS",
  "THUMBNAIL",
] as const;
export type Capability = (typeof CAPABILITIES)[number];

/** Honest result of any publish attempt. Never fake success. */
export interface PublishResult {
  ok: boolean;
  /** Machine code: NOT_CONFIGURED | PLATFORM_APPROVAL_REQUIRED | AUTH_REQUIRED |
   *  RATE_LIMITED | RETRYABLE_ERROR | PERMANENT_ERROR | NETWORK_ERROR */
  code?: string;
  message: string;
  externalPostId?: string;
  externalUrl?: string;
}

export interface ApiError {
  ok: false;
  code: string;
  message: string;
}

export interface ApiOk<T> {
  ok: true;
  data: T;
}

export type ApiResponse<T> = ApiOk<T> | ApiError;

/** Friendly actor labels for the UI. DB stores the generic ActorType. */
export const ACTOR_LABELS: Record<string, string> = {
  USER: "Ahmed",
  AUTOMATION: "Automation",
  SYSTEM: "System",
  API: "API",
};
