import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireApiUser } from "@/lib/session";
import { audit, AuditActions } from "@/lib/audit";
import {
  ok,
  fail,
  validationError,
  unexpectedError,
  authFailureResponse,
} from "@/lib/api";

/**
 * Editable PlatformContent fields. Every edit bumps `version` so the
 * scheduler's locked-version rule (§6) can distinguish what was approved
 * from what was changed afterwards. Manual edits are applied as-is —
 * never auto-overwritten.
 */
const editContentSchema = z.object({
  title: z.string().trim().max(300).optional(),
  hook: z.string().trim().max(3000).optional(),
  caption: z.string().trim().max(10000).optional(),
  description: z.string().trim().max(20000).optional(),
  cta: z.string().trim().max(200).optional(),
  hashtags: z.array(z.string().trim().max(60)).max(50).optional(),
  tags: z.array(z.string().trim().max(80)).max(50).optional(),
  keywords: z.array(z.string().trim().max(80)).max(50).optional(),
  videoIdea: z.string().trim().max(5000).optional(),
  mediaAssetId: z.string().trim().min(1).nullable().optional(),
});

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function PATCH(req: NextRequest, { params }: RouteParams): Promise<Response> {
  try {
    const user = await requireApiUser();
    const { id } = await params;
    const body: unknown = await req.json().catch(() => null);
    const parsed = editContentSchema.safeParse(body);
    if (!parsed.success) return validationError(parsed.error);

    const existing = await db.platformContent.findFirst({
      where: { id },
      include: { campaign: { select: { userId: true } } },
    });
    if (!existing || existing.campaign.userId !== user.id) {
      return fail("NOT_FOUND", "Content not found.", 404);
    }

    // If a media asset is attached, it must belong to this user.
    if (parsed.data.mediaAssetId) {
      const asset = await db.mediaAsset.findFirst({
        where: { id: parsed.data.mediaAssetId, userId: user.id },
        select: { id: true },
      });
      if (!asset) {
        return fail("NOT_FOUND", "Media asset not found.", 404);
      }
    }

    const { mediaAssetId, ...fields } = parsed.data;
    const data: Record<string, unknown> = { ...fields };
    if (mediaAssetId !== undefined) {
      data.mediaAsset = mediaAssetId
        ? { connect: { id: mediaAssetId } }
        : { disconnect: true };
    }

    const updated = await db.platformContent.update({
      where: { id },
      data: {
        ...data,
        version: { increment: 1 },
      },
    });

    await audit({
      userId: user.id,
      actorType: "USER",
      action: AuditActions.CONTENT_EDITED,
      entityType: "PlatformContent",
      entityId: updated.id,
      platform: updated.platform,
      safeMetadata: { version: updated.version },
    });

    return ok(updated);
  } catch (err) {
    return authFailureResponse(err) ?? unexpectedError("editing content");
  }
}
