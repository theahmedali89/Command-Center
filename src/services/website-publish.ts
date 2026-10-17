// Shared WordPress publishing service.
// Used by the dashboard publish route (user session) and the agent publish
// route (API-key auth). Same validation, same capability detection, same
// audit trail — only the actor differs.

import { z } from "zod";
import { db } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto";
import { audit, AuditActions } from "@/lib/audit";
import { WordPressClient, WordPressError, type CapabilityInfo } from "@/providers/wordpress/client";
import type { ActorType } from "@/types";

export const websitePublishSchema = z.object({
  title: z.string().trim().min(1, "Title is required.").max(500),
  html: z.string().min(1, "Content is required.").max(5_000_000),
  slug: z.string().trim().min(1).max(200).optional(),
  status: z.enum(["publish", "draft"]).default("draft"),
  category: z.string().trim().min(1).max(200).optional(),
  tags: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
  featuredMediaUrl: z.string().trim().max(2000).optional(),
  featuredMediaAlt: z.string().trim().max(500).optional(),
  yoastTitle: z.string().trim().max(200).optional(),
  yoastDescription: z.string().trim().max(500).optional(),
});

export type WebsitePublishInput = z.infer<typeof websitePublishSchema>;

export interface WebsitePublishResult {
  ok: boolean;
  code: string;
  message: string;
  httpStatus: number;
  postId?: number;
  url?: string | null;
  yoastApplied?: boolean;
}

const MAX_MEDIA_BYTES = 5 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;

/** Download error for the featured image. Carries a safe code + HTTP status. */
class MediaDownloadError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "MediaDownloadError";
    this.code = code;
    this.message = message;
    this.status = status;
  }
}

interface DownloadedImage {
  bytes: Uint8Array;
  mimeType: string;
  filename: string;
}

/**
 * Server-side download of the featured image: http(s) only, image/* only,
 * hard 5 MB cap enforced while streaming (never buffers an unbounded body).
 */
export async function downloadImage(rawUrl: string): Promise<DownloadedImage> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new MediaDownloadError("INVALID_MEDIA_URL", "Featured media URL is not valid.", 400);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new MediaDownloadError(
      "INVALID_MEDIA_URL",
      "Featured media URL must be http(s).",
      400,
    );
  }

  let res: Response;
  try {
    res = await fetch(parsed.toString(), {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { Accept: "image/*" },
    });
  } catch {
    throw new MediaDownloadError(
      "MEDIA_DOWNLOAD_FAILED",
      "Could not download the featured image.",
      502,
    );
  }
  if (!res.ok || !res.body) {
    throw new MediaDownloadError(
      "MEDIA_DOWNLOAD_FAILED",
      `Featured image download failed (HTTP ${res.status}).`,
      502,
    );
  }
  const mimeType = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!mimeType.startsWith("image/")) {
    await res.body.cancel().catch(() => undefined);
    throw new MediaDownloadError("INVALID_MEDIA_TYPE", "Featured media must be an image.", 400);
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_MEDIA_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new MediaDownloadError(
          "MEDIA_TOO_LARGE",
          "Featured image exceeds the 5 MB limit.",
          400,
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const filename = parsed.pathname.split("/").filter(Boolean).pop() ?? "featured-image";
  return { bytes, mimeType, filename };
}

function codeOf(err: unknown): string {
  return err instanceof WordPressError ? err.code : "PUBLISH_FAILED";
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : "WordPress request failed.";
}

export async function publishToWebsite(opts: {
  websiteId: string;
  userId: string;
  input: WebsitePublishInput;
  actorType: ActorType;
  actorId?: string;
}): Promise<WebsitePublishResult> {
  const { websiteId, userId, input, actorType, actorId } = opts;

  const website = await db.website.findFirst({ where: { id: websiteId, userId } });
  if (!website) {
    return { ok: false, code: "NOT_FOUND", message: "Website not found.", httpStatus: 404 };
  }
  if (website.status !== "CONNECTED") {
    return {
      ok: false,
      code: "WEBSITE_NOT_CONNECTED",
      message: `Website is ${website.status}; verify the connection before publishing.`,
      httpStatus: 409,
    };
  }

  const fail = async (
    code: string,
    message: string,
    httpStatus: number,
  ): Promise<WebsitePublishResult> => {
    await audit({
      userId,
      actorType,
      actorId,
      action: AuditActions.POST_FAILED,
      entityType: "Website",
      entityId: websiteId,
      platform: "wordpress",
      safeMetadata: { code, message: message.slice(0, 300) },
    });
    return { ok: false, code, message, httpStatus };
  };

  const client = new WordPressClient({
    baseUrl: website.url,
    username: website.wpUsername,
    appPassword: decryptSecret(website.encryptedAppPassword),
  });

  // 1. Capabilities — never assume REST or Yoast writability.
  let capabilities: CapabilityInfo;
  try {
    capabilities = await client.detectCapabilities();
  } catch (err) {
    return fail(codeOf(err), messageOf(err), 502);
  }
  if (!capabilities.rest) {
    return fail("NOT_CONFIGURED", "The WordPress REST API is not available on this site.", 502);
  }

  // 2. Category (find-or-create). Best-effort: if category assignment fails,
  // log and continue without category rather than failing the entire publish.
  let categoryIds: number[] | undefined;
  if (input.category) {
    try {
      categoryIds = [await client.ensureCategory(input.category)];
    } catch (err) {
      // Non-blocking: category assignment failed, continue without it.
      // The post is more important than the category.
      await audit({
        userId,
        actorType,
        actorId,
        action: AuditActions.POST_FAILED,
        entityType: "Website",
        entityId: websiteId,
        platform: "wordpress",
        safeMetadata: {
          code: "CATEGORY_SKIPPED",
          message: `Category "${input.category}" could not be assigned: ${messageOf(err).slice(0, 200)}. Post will publish without category.`,
        },
      });
    }
  }

  // 3. Tags (find-or-create each).
  let tagIds: number[] | undefined;
  if (input.tags && input.tags.length > 0) {
    try {
      tagIds = [];
      for (const tag of input.tags) {
        tagIds.push(await client.ensureTag(tag));
      }
    } catch (err) {
      return fail(codeOf(err), messageOf(err), 502);
    }
  }

  // 4. Featured image: server-side fetch (5 MB cap, image/* only) then upload.
  let featuredMediaId: number | undefined;
  if (input.featuredMediaUrl) {
    try {
      const image = await downloadImage(input.featuredMediaUrl);
      const uploaded = await client.uploadMedia(image.bytes, image.filename, image.mimeType);
      featuredMediaId = uploaded.id;
      // Set alt text on featured image (Ahmed's standing order: every image MUST have alt text)
      if (input.featuredMediaAlt) {
        await client.setMediaAltText(uploaded.id, input.featuredMediaAlt);
      }
    } catch (err) {
      if (err instanceof MediaDownloadError) return fail(err.code, err.message, err.status);
      return fail(codeOf(err), messageOf(err), 502);
    }
  }

  // 5. Create the post.
  const created = await client.createPost({
    title: input.title,
    content: input.html,
    slug: input.slug,
    status: input.status,
    categoryIds,
    tagIds,
    featuredMediaId,
    yoastTitle: input.yoastTitle,
    yoastDescription: input.yoastDescription,
    yoastMeta: capabilities.yoastMeta,
  });
  if (!created.ok) {
    return fail(
      created.code ?? "PUBLISH_FAILED",
      created.message ?? "WordPress rejected the post.",
      502,
    );
  }

  await db.website.update({ where: { id: websiteId }, data: { lastVerifiedAt: new Date() } });
  await audit({
    userId,
    actorType,
    actorId,
    action: AuditActions.POST_PUBLISHED,
    entityType: "Website",
    entityId: websiteId,
    platform: "wordpress",
    safeMetadata: {
      postId: created.id ?? null,
      url: created.url ?? null,
      yoastApplied: created.yoastApplied ?? false,
    },
  });

  return {
    ok: true,
    code: "OK",
    message: "Published to WordPress.",
    httpStatus: 200,
    postId: created.id,
    url: created.url ?? null,
    yoastApplied: created.yoastApplied ?? false,
  };
}
