import { z } from "zod";
import { agentUnauthorized, verifyAgentKey } from "@/lib/agent-auth";
import { db } from "@/lib/db";
import { WordPressClient } from "@/providers/wordpress/client";
import { decryptSecret } from "@/lib/crypto";
import { audit, AuditActions } from "@/lib/audit";

const updateSchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  html: z.string().trim().min(1).optional(),
  category: z.string().trim().max(120).optional(),
  tags: z.array(z.string().trim().max(60)).max(20).optional(),
  featuredMediaUrl: z.string().trim().max(2000).optional(),
  yoastTitle: z.string().trim().max(200).optional(),
  yoastDescription: z.string().trim().max(400).optional(),
});

type UpdateInput = z.infer<typeof updateSchema>;

/**
 * PUT /api/agent/websites/[id]/posts/[postId]
 * Agent-authenticated update of an existing WordPress post.
 *
 * Auth: Authorization: Bearer <agent-api-key>
 * Body: { title?, html?, category?, tags?, featuredMediaUrl?, yoastTitle?, yoastDescription? }
 * Only provided fields are updated. Slug/status/date are never changed.
 */
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string; postId: string }> },
): Promise<Response> {
  const identity = await verifyAgentKey(req);
  if (!identity) {
    return agentUnauthorized();
  }
  const { id, postId } = await params;
  const wpPostId = Number(postId);
  if (!Number.isInteger(wpPostId) || wpPostId <= 0) {
    return Response.json(
      { ok: false, code: "INVALID_POST_ID", message: "Invalid postId." },
      { status: 400 },
    );
  }

  const website = await db.website.findFirst({
    where: { id, userId: identity.userId },
  });
  if (!website) {
    return Response.json(
      { ok: false, code: "WEBSITE_NOT_FOUND", message: "Website not found." },
      { status: 404 },
    );
  }
  if (website.status !== "CONNECTED") {
    return Response.json(
      { ok: false, code: "WEBSITE_NOT_CONNECTED", message: `Website is ${website.status}.` },
      { status: 409 },
    );
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return Response.json(
      { ok: false, code: "INVALID_JSON", message: "Invalid JSON body." },
      { status: 400 },
    );
  }
  const parsed = updateSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json(
      { ok: false, code: "VALIDATION_ERROR", message: "Invalid input.", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const input: UpdateInput = parsed.data;
  if (Object.keys(input).length === 0) {
    return Response.json(
      { ok: false, code: "EMPTY_UPDATE", message: "No fields to update." },
      { status: 400 },
    );
  }

  const client = new WordPressClient({
    baseUrl: website.url,
    username: website.wpUsername,
    appPassword: decryptSecret(website.encryptedAppPassword),
  });

  try {
    const capabilities = await client.detectCapabilities();

    // Resolve category/tags to IDs (same logic as publish).
    let categoryIds: number[] | undefined;
    if (input.category) {
      categoryIds = [await client.ensureCategory(input.category)];
    }
    let tagIds: number[] | undefined;
    if (input.tags && input.tags.length > 0) {
      tagIds = [];
      for (const t of input.tags) {
        tagIds.push(await client.ensureTag(t));
      }
    }

    // Featured image: download from URL then upload.
    let featuredMediaId: number | undefined;
    if (input.featuredMediaUrl) {
      const { downloadImage } = await import("@/services/website-publish");
      const image = await downloadImage(input.featuredMediaUrl);
      const uploaded = await client.uploadMedia(image.bytes, image.filename, image.mimeType);
      featuredMediaId = uploaded.id;
    }

    const result = await client.updatePost(wpPostId, {
      title: input.title,
      content: input.html,
      categoryIds,
      tagIds,
      featuredMediaId,
      yoastTitle: input.yoastTitle,
      yoastDescription: input.yoastDescription,
      yoastSupported: capabilities.yoastMetaWritable,
    });

    if (!result.ok) {
      return Response.json(
        { ok: false, code: result.code ?? "UPDATE_FAILED", message: result.message ?? "Update failed." },
        { status: 502 },
      );
    }

    await audit({
      userId: identity.userId,
      actorType: "AUTOMATION",
      actorId: "milo-runtime",
      action: AuditActions.POST_PUBLISHED,
      entityType: "Website",
      entityId: id,
      platform: "wordpress",
      safeMetadata: { postId: result.id ?? wpPostId, url: result.url ?? null, updated: true },
    });

    return Response.json({
      ok: true,
      code: "OK",
      message: "Post updated.",
      postId: result.id ?? wpPostId,
      url: result.url ?? null,
      yoastApplied: result.yoastApplied ?? false,
    });
  } catch (err) {
    return Response.json(
      {
        ok: false,
        code: "UPDATE_FAILED",
        message: err instanceof Error ? err.message : "Update failed.",
      },
      { status: 502 },
    );
  }
}
