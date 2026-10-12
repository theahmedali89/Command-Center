// Shared interfaces for the social platform provider layer.
// Every platform adapter implements SocialProvider. The core (content,
// scheduler, publishing engine) only talks to this interface — never to a
// specific platform. Honest states only: stubs never fake a success.

import type { Capability, PlatformId, PublishResult } from "@/types";

/** Static metadata describing one platform adapter. */
export interface PlatformMeta {
  id: PlatformId;
  name: string;
  capabilities: Capability[];
  notes: string;
  docsUrl?: string;
}

/** Input to the OAuth callback step: the code + state returned by the platform. */
export interface OAuthCallbackInput {
  code: string;
  state: string;
}

/** Account data returned by a provider after a successful OAuth exchange. */
export interface ConnectedAccount {
  externalAccountId: string;
  accountName: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  scopes?: string;
}

/** Text content input for validation. */
export interface ValidateContentInput {
  title?: string;
  caption?: string;
  description?: string;
  hashtags?: string[];
}

/** One media file for validation (mime type + byte size). */
export interface MediaItem {
  mimeType: string;
  size: number;
}

/** A publish request assembled by the publishing engine. */
export interface PublishInput {
  title?: string;
  caption?: string;
  description?: string;
  hashtags?: string[];
  link?: string;
  mediaUrls?: string[];
}

/** Result of a validation step: ok plus human-readable issues. */
export interface ValidationResult {
  ok: boolean;
  issues: string[];
}

/**
 * The platform adapter contract. See command-center-plan.md §1/§2/§5/§12.
 * - getAuthorizationUrl / handleCallback / refreshCredentials: real OAuth where
 *   wired; stub implementations throw NOT_CONFIGURED (never fake tokens).
 * - validateContent / validateMedia: deterministic client-side checks.
 * - publish: honest PublishResult — never ok:true from a stub.
 */
export interface SocialProvider {
  meta: PlatformMeta;
  getCapabilities(): Capability[];
  getAuthorizationUrl(state: string): Promise<string>;
  handleCallback(input: OAuthCallbackInput): Promise<ConnectedAccount>;
  refreshCredentials(account: {
    encryptedAccessToken?: string | null;
    encryptedRefreshToken?: string | null;
  }): Promise<{ accessToken: string; refreshToken?: string; expiresAt?: Date }>;
  validateContent(content: ValidateContentInput): Promise<ValidationResult>;
  validateMedia(media: MediaItem[]): Promise<ValidationResult>;
  publish(request: PublishInput): Promise<PublishResult>;
  getPublishStatus?(externalPostId: string): Promise<{ status: string }>;
}
