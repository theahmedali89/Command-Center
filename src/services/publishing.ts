import { db } from "@/lib/db";
import { audit, AuditActions } from "@/lib/audit";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { WordPressClient, type CapabilityInfo } from "@/providers/wordpress/client";
import { getSocialProvider } from "@/providers/social";
import {
  ActorType,
  PlatformId,
  PublishStatus,
  type PublishResult,
} from "@/types";
import {
  MAX_ATTEMPTS,
  classifyPublishError,
  computeNextRetry,
  isRetryable,
} from "@/lib/retry";

export interface ExecutePublishOptions {
  scheduledPostId: string;
  actorType: ActorType;
  actorId?: string;
}

function permanentError(message: string): PublishResult {
  return { ok: false, code: "PERMANENT_ERROR", message };
}

/**
 * Execute one publish for a ScheduledPost.
 *
 * Idempotent: a post already PUBLISHED with an externalPostId short-circuits
 * to success without reposting. Retries check state first — duplicates are
 * the worst possible bug here, so no path posts twice.
 */
export async function executePublish(
  opts: ExecutePublishOptions,
): Promise<PublishResult> {
  const post = await db.scheduledPost.findUnique({
    where: { id: opts.scheduledPostId },
    include: {
      platformContent: { include: { campaign: true, mediaAsset: true } },
      socialAccount: true,
    },
  });

  if (!post) {
    return permanentError("Scheduled post not found.");
  }

  // IDEMPOTENCY GUARD — already published is success, never a repost.
  if (post.status === PublishStatus.PUBLISHED && post.externalPostId) {
    return {
      ok: true,
      message: "Already published.",
      externalPostId: post.externalPostId,
      externalUrl: post.externalUrl ?? undefined,
    };
  }

  if (post.status !== PublishStatus.SCHEDULED && post.status !== PublishStatus.FAILED) {
    return permanentError(
      `Scheduled post is not in a publishable state (current: ${post.status}).`,
    );
  }

  const content = post.platformContent;
  const userId = content.campaign.userId;

  await db.scheduledPost.update({
    where: { id: post.id },
    data: { status: PublishStatus.PROCESSING, lastErrorCode: null },
  });

  await audit({
    userId,
    actorType: opts.actorType,
    actorId: opts.actorId,
    action: AuditActions.POST_PUBLISH_STARTED,
    entityType: "ScheduledPost",
    entityId: post.id,
    platform: content.platform,
  });

  try {
    let result: PublishResult;
    if (post.websiteId) {
      // NOTE: ScheduledPost.websiteId is a bare FK (no Prisma relation);
      // the website is loaded separately and scoped to the same user.
      const website = await db.website.findUnique({
        where: { id: post.websiteId, userId },
      });
      result = website
        ? await publishToWordPress(website, content)
        : permanentError("Website not found for this scheduled post.");
    } else if (post.socialAccountId && post.socialAccount) {
      result = await publishToSocial(
        post.socialAccount,
        {
          ...content,
          link: content.campaign.destinationUrl,
          mediaUrl: content.mediaAsset?.publicUrl ?? null,
        },
      );
    } else {
      result = permanentError(
        "Scheduled post has neither a website nor a social account attached.",
      );
    }

    if (result.ok) {
      await db.scheduledPost.update({
        where: { id: post.id },
        data: {
          status: PublishStatus.PUBLISHED,
          publishedAt: new Date(),
          externalPostId: result.externalPostId ?? null,
          externalUrl: result.externalUrl ?? null,
          nextRetryAt: null,
          lastErrorCode: null,
          lastSafeErrorMessage: null,
        },
      });
      await db.platformContent.update({
        where: { id: content.id },
        data: { status: PublishStatus.PUBLISHED },
      });
      await audit({
        userId,
        actorType: opts.actorType,
        actorId: opts.actorId,
        action: AuditActions.POST_PUBLISHED,
        entityType: "ScheduledPost",
        entityId: post.id,
        platform: content.platform,
        safeMetadata: {
          externalPostId: result.externalPostId ?? null,
          externalUrl: result.externalUrl ?? null,
        },
      });
    } else {
      await recordFailure(
        {
          postId: post.id,
          attemptCount: post.attemptCount,
          contentId: content.id,
          platform: content.platform,
        },
        userId,
        opts,
        result,
      );
    }

    return result;
  } catch (err) {
    // Unexpected internal error — treat as retryable, never throw secrets.
    const result: PublishResult = {
      ok: false,
      code: "RETRYABLE_ERROR",
      message: `Internal publish error: ${(err as Error).message}`,
    };
    await recordFailure(
      {
        postId: post.id,
        attemptCount: post.attemptCount,
        contentId: content.id,
        platform: content.platform,
      },
      userId,
      opts,
      result,
    );
    return result;
  }
}

type FailureRecord = {
  postId: string;
  attemptCount: number;
  contentId: string;
  platform: string;
};

async function recordFailure(
  record: FailureRecord,
  userId: string,
  opts: ExecutePublishOptions,
  result: PublishResult,
): Promise<void> {
  const errorClass = classifyPublishError(result.code);
  const nextAttempt = record.attemptCount + 1;
  const retryable = isRetryable(errorClass) && nextAttempt < MAX_ATTEMPTS;

  await db.scheduledPost.update({
    where: { id: record.postId },
    data: {
      status: PublishStatus.FAILED,
      attemptCount: nextAttempt,
      lastAttemptAt: new Date(),
      nextRetryAt: retryable ? computeNextRetry(nextAttempt) : null,
      lastErrorCode: result.code ?? "RETRYABLE_ERROR",
      // Provider messages must be safe (no secrets); stored as-is for the UI.
      lastSafeErrorMessage: result.message.slice(0, 1000),
    },
  });
  await db.platformContent.update({
    where: { id: record.contentId },
    data: { status: PublishStatus.FAILED },
  });

  await audit({
    userId,
    actorType: opts.actorType,
    actorId: opts.actorId,
    action: AuditActions.POST_FAILED,
    entityType: "ScheduledPost",
    entityId: record.postId,
    platform: record.platform,
    safeMetadata: {
      errorCode: result.code ?? "RETRYABLE_ERROR",
      errorClass,
      attempt: nextAttempt,
      willRetry: retryable,
    },
  });
}

type WpTarget = { url: string; wpUsername: string; encryptedAppPassword: string };

type ContentShape = {
  title: string | null;
  caption: string | null;
  description: string | null;
  hashtags: string[];
  link?: string | null;
  mediaUrl?: string | null;
};

async function publishToWordPress(
  website: WpTarget,
  content: ContentShape,
): Promise<PublishResult> {
  let appPassword: string;
  try {
    appPassword = decryptSecret(website.encryptedAppPassword);
  } catch {
    return { ok: false, code: "AUTH_REQUIRED", message: "Stored WordPress app password could not be decrypted." };
  }

  const client = new WordPressClient({
    baseUrl: website.url,
    username: website.wpUsername,
    appPassword,
  });

  let caps: CapabilityInfo;
  try {
    caps = await client.detectCapabilities();
  } catch (err) {
    return {
      ok: false,
      code: "RETRYABLE_ERROR",
      message: `WordPress capability check failed: ${(err as Error).message}`,
    };
  }

  if (!caps.rest) {
    return {
      ok: false,
      code: "NOT_CONFIGURED",
      message: "WordPress REST API is not available on this site.",
    };
  }

  const created = await client.createPost({
    title: content.title ?? "",
    content: content.caption ?? "",
    status: "publish",
    yoastTitle: content.title ?? undefined,
    yoastDescription: content.description ?? undefined,
    yoastMeta: caps.yoastMeta,
  });

  if (!created.ok) {
    return {
      ok: false,
      code: created.code ?? "RETRYABLE_ERROR",
      message: created.message ?? "WordPress post creation failed.",
    };
  }

  return {
    ok: true,
    message: "Published to WordPress.",
    externalPostId: created.id != null ? String(created.id) : undefined,
    externalUrl: created.url,
  };
}

type SocialTarget = {
  id: string;
  userId: string;
  platform: string;
  connectionStatus: string;
  encryptedAccessToken?: string | null;
  encryptedRefreshToken?: string | null;
  tokenExpiresAt?: Date | null;
  boardId?: string | null;
};

async function publishToSocial(
  account: SocialTarget,
  content: ContentShape,
): Promise<PublishResult> {
  if (account.connectionStatus !== "CONNECTED") {
    return {
      ok: false,
      code: "AUTH_REQUIRED",
      message: `Social account is not connected (status: ${account.connectionStatus}).`,
    };
  }

  // SocialAccount.platform is a plain string in the DB; the provider
  // registry keys by PlatformId, so narrow with a safe cast.
  const provider = getSocialProvider(account.platform as PlatformId);
  if (!provider) {
    return permanentError(`Unsupported platform: ${account.platform}.`);
  }

  // Resolve a usable access token: refresh when expired (5-minute buffer).
  let accessToken: string | undefined;
  if (account.encryptedAccessToken) {
    try {
      accessToken = decryptSecret(account.encryptedAccessToken);
    } catch {
      return {
        ok: false,
        code: "AUTH_REQUIRED",
        message: "Stored social token could not be decrypted — reconnect the account.",
      };
    }
    const expired =
      account.tokenExpiresAt &&
      account.tokenExpiresAt.getTime() < Date.now() + 5 * 60 * 1000;
    if (expired) {
      try {
        const refreshed = await provider.refreshCredentials({
          encryptedAccessToken: account.encryptedAccessToken,
          encryptedRefreshToken: account.encryptedRefreshToken,
        });
        accessToken = refreshed.accessToken;
        await db.socialAccount.update({
          where: { id: account.id },
          data: {
            encryptedAccessToken: encryptSecret(refreshed.accessToken),
            encryptedRefreshToken: refreshed.refreshToken
              ? encryptSecret(refreshed.refreshToken)
              : undefined,
            tokenExpiresAt: refreshed.expiresAt ?? null,
            lastVerifiedAt: new Date(),
            lastError: null,
          },
        });
        await audit({
          userId: account.userId,
          actorType: "AUTOMATION",
          action: AuditActions.TOKEN_REFRESHED,
          entityType: "SocialAccount",
          entityId: account.id,
          platform: account.platform,
        });
      } catch {
        await db.socialAccount.update({
          where: { id: account.id },
          data: {
            connectionStatus: "AUTH_REQUIRED",
            lastError: "Token refresh failed — reconnect the account.",
          },
        });
        return {
          ok: false,
          code: "AUTH_REQUIRED",
          message: "Social token expired and refresh failed — reconnect the account.",
        };
      }
    }
  }

  const result = await provider.publish({
    title: content.title ?? undefined,
    caption: content.caption ?? undefined,
    description: content.description ?? undefined,
    hashtags: content.hashtags,
    link: content.link ?? undefined,
    accessToken,
    boardId: account.boardId ?? undefined,
    mediaUrls: content.mediaUrl ? [content.mediaUrl] : undefined,
  });

  // A 401 from the provider means the token died mid-flight: mark the
  // account so the user reconnects instead of burning retries.
  if (result.code === "AUTH_REQUIRED") {
    await db.socialAccount.update({
      where: { id: account.id },
      data: {
        connectionStatus: "AUTH_REQUIRED",
        lastError: result.message,
      },
    });
  }
  return result;
}
