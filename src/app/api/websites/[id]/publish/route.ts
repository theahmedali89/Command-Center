import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser } from "@/lib/session";
import { db } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto";
import { audit, AuditActions } from "@/lib/audit";
import { WordPressClient, WordPressError } from "@/providers/wordpress/client";

type ApiUser = { id: string; email: string; name: string | null };
type RouteContext = { params: Promise<{ id: string }> };

const publishSchema = z.object({
  title: z.string().trim().min(1, "Title is required.").max(500),
  html: z.string().min(1, "Content is required.").max(5_000_000),
  slug: z.string().trim().min(1).max(200).optional(),
  status: z.enum(["publish", "draft"]).default("draft"),
  category: z.string().trim().min(1).max(200).optional(),
  tags: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
  featuredMediaUrl: z.string().trim().max(2000).optional(),
  yoastTitle: z.string().trim().max(200).optional(),
  yoastDescription: z.string().trim().max(500).optional(),
});

type PublishInput = z.infer<typeof publishSchema>;

const MAX_MEDIA_BYTES = 5 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;

async function authed(): Promise<ApiUser | Response> {
  try {
    return await requireApiUser();
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }
}

function codeOf(err: unknown): string {
  return err instanceof WordPressError ? err.code : "PUBLISH_FAILED";
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : "WordPress request failed.";
}

/** Download error for the featured image. Carries a safe code + HTTP status. */
class MediaDownloadError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "MediaDownloadError";
    this.code = code;
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
async function downloadImage(rawUrl: string): Promise<DownloadedImage> {
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
      400
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
      502
    );
  }
  if (!res.ok || !res.body) {
    throw new MediaDownloadError(
      "MEDIA_DOWNLOAD_FAILED",
      `Featured image download failed (HTTP ${res.status}).`,
      502
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
          400
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

/**
 * POST /api/websites/[id]/publish — publish (or draft) a post to a connected
 * WordPress site. Capability-detected Yoast handling, server-side featured
 * image fetch with a 5 MB cap, every outcome audited.
 */
export async function POST(req: Request, ctx: RouteContext): Promise<Response> {
  const user = await authed();
  if (user instanceof Response) return user;
  const { id } = await ctx.params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = null;
  }
  const parsed = publishSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues
      .map((i) => `${i.path.join(".") || "body"}: ${i.message}`)
      .join("; ");
    return NextResponse.json(
      { ok: false, code: "VALIDATION_ERROR", message },
      { status: 400 }
    );
  }
  const input: PublishInput = parsed.data;

  const website = await db.website.findFirst({ where: { id, userId: user.id } });
  if (!website) {
    return NextResponse.json(
      { ok: false, code: "NOT_FOUND", message: "Website not found." },
      { status: 404 }
    );
  }
  if (website.status !== "CONNECTED") {
    return NextResponse.json(
      {
        ok: false,
        code: "WEBSITE_NOT_CONNECTED",
        message: `Website is ${website.status}; verify the connection before publishing.`,
      },
      { status: 409 }
    );
  }

  const fail = async (code: string, message: string, status: number): Promise<Response> => {
    await audit({
      userId: user.id,
      actorType: "USER",
      actorId: user.id,
      action: AuditActions.POST_FAILED,
      entityType: "Website",
      entityId: id,
      platform: "wordpress",
      safeMetadata: { code, message: message.slice(0, 300) },
    });
    return NextResponse.json({ ok: false, code, message }, { status });
  };

  const client = new WordPressClient({
    baseUrl: website.url,
    username: website.wpUsername,
    appPassword: decryptSecret(website.encryptedAppPassword),
  });

  // 1. Capabilities — never assume REST or Yoast writability.
  let capabilities: { rest: boolean; yoastMetaWritable: boolean };
  try {
    capabilities = await client.detectCapabilities();
  } catch (err) {
    return fail(codeOf(err), messageOf(err), 502);
  }
  if (!capabilities.rest) {
    return fail("NOT_CONFIGURED", "The WordPress REST API is not available on this site.", 502);
  }

  // 2. Category (find-or-create).
  let categoryIds: number[] | undefined;
  if (input.category) {
    try {
      categoryIds = [await client.ensureCategory(input.category)];
    } catch (err) {
      return fail(codeOf(err), messageOf(err), 502);
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
    yoastSupported: capabilities.yoastMetaWritable,
  });
  if (!created.ok) {
    return fail(created.code ?? "PUBLISH_FAILED", created.message ?? "WordPress rejected the post.", 502);
  }

  await db.website.update({ where: { id }, data: { lastVerifiedAt: new Date() } });
  await audit({
    userId: user.id,
    actorType: "USER",
    actorId: user.id,
    action: AuditActions.POST_PUBLISHED,
    entityType: "Website",
    entityId: id,
    platform: "wordpress",
    safeMetadata: {
      postId: created.id ?? null,
      url: created.url ?? null,
      yoastApplied: created.yoastApplied ?? false,
    },
  });

  return NextResponse.json({
    ok: true,
    data: {
      postId: created.id,
      url: created.url ?? null,
      yoastApplied: created.yoastApplied ?? false,
    },
  });
}
