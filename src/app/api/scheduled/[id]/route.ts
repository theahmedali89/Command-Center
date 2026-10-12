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

const actionSchema = z.object({
  action: z.enum(["cancel", "retry"], {
    error: 'action must be "cancel" or "retry"',
  }),
});

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, { params }: RouteParams): Promise<Response> {
  try {
    const user = await requireApiUser();
    const { id } = await params;
    const body: unknown = await req.json().catch(() => null);
    const parsed = actionSchema.safeParse(body);
    if (!parsed.success) return validationError(parsed.error);

    const existing = await db.scheduledPost.findFirst({
      where: {
        id,
        platformContent: { campaign: { userId: user.id } },
      },
      include: {
        platformContent: { select: { platform: true } },
      },
    });
    if (!existing) {
      return fail("NOT_FOUND", "Scheduled post not found.", 404);
    }

    if (parsed.data.action === "cancel") {
      if (existing.status === "PUBLISHED") {
        return fail(
          "INVALID_STATE",
          "Already-published posts cannot be cancelled.",
          409,
        );
      }
      const updated = await db.scheduledPost.update({
        where: { id },
        data: { status: "CANCELLED", nextRetryAt: null },
      });
      await audit({
        userId: user.id,
        actorType: "USER",
        action: "POST_CANCELLED",
        entityType: "ScheduledPost",
        entityId: updated.id,
        platform: existing.platformContent.platform,
      });
      return ok(updated);
    }

    // action === "retry": re-queue now; attempt history is kept.
    if (existing.status === "PUBLISHED") {
      return fail("INVALID_STATE", "Already-published posts cannot be retried.", 409);
    }
    const updated = await db.scheduledPost.update({
      where: { id },
      data: {
        status: "SCHEDULED",
        nextRetryAt: new Date(),
      },
    });
    await audit({
      userId: user.id,
      actorType: "USER",
      action: AuditActions.POST_RETRIED,
      entityType: "ScheduledPost",
      entityId: updated.id,
      platform: existing.platformContent.platform,
      safeMetadata: { attemptCount: updated.attemptCount },
    });
    return ok(updated);
  } catch (err) {
    return authFailureResponse(err) ?? unexpectedError("updating scheduled post");
  }
}
