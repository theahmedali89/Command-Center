// Social provider registry: the single place platform adapters are listed.
// The core (content, scheduler, publishing engine) resolves adapters through
// getSocialProvider() only — never by importing a platform file directly.
// WordPress is intentionally excluded here; it lives under src/providers/wp/.

import type { PlatformId } from "@/types";
import type { PlatformMeta, SocialProvider } from "./types";
import { facebookProvider } from "./facebook";
import { instagramProvider } from "./instagram";
import { youtubeProvider } from "./youtube";
import { tiktokProvider } from "./tiktok";
import { pinterestProvider } from "./pinterest";
import { xProvider } from "./x";
import { threadsProvider } from "./threads";
import { telegramProvider } from "./telegram";
import { tumblrProvider } from "./tumblr";
import { blueskyProvider } from "./bluesky";
import { linkedinProvider } from "./linkedin";

export type SocialProviderId = Exclude<PlatformId, "wordpress">;

const PROVIDERS: Record<SocialProviderId, SocialProvider> = {
  facebook: facebookProvider,
  instagram: instagramProvider,
  youtube: youtubeProvider,
  tiktok: tiktokProvider,
  pinterest: pinterestProvider,
  x: xProvider,
  threads: threadsProvider,
  telegram: telegramProvider,
  tumblr: tumblrProvider,
  bluesky: blueskyProvider,
  linkedin: linkedinProvider,
};

/** Metadata for every social platform adapter (WordPress excluded). */
export const SOCIAL_PROVIDERS: PlatformMeta[] = (
  Object.values(PROVIDERS) as SocialProvider[]
).map((p) => p.meta);

/**
 * Resolve the adapter for a platform. Returns undefined for unknown ids and
 * for "wordpress" (which has its own provider under src/providers/wp/).
 */
export function getSocialProvider(id: PlatformId): SocialProvider | undefined {
  if (id === "wordpress") return undefined;
  return PROVIDERS[id as SocialProviderId];
}
