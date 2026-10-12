import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireApiUser } from "@/lib/session";
import { buildIdempotencyKey } from "@/lib/idempotency";
import { audit, AuditActions } from "@/lib/audit";
import { PublishStatus } from "@/types";
import {
  ok,
  fail,
  validationError,
  unexpectedError,
  authFailureResponse,
  isUniqueViolation,
} from "@/lib/api";

const scheduleSchema = z
  .object({
    platformContentId: z.string().trim().min(1, "platformContentId is required"),
    accountId: z.string().trim().min(1).optional(),
    websiteId: z.string().trim().min(1).optional(),
    scheduledAtUtc: z
      .string()
      .datetime({ offset: true, error: "scheduledAtUtc must be an ISO 8601 datetime" }),
    displayTimezone: z.string().trim().max(64).optional(),
  })
  .refine(
    (d) => (d.accountId ? 1 : 0) + (d.websiteId ? 1 : 0) === 1,
    "Exactly one of accountId or websiteId is required.",
  );

export async function GET(req: NextRequest): Promise<Response> {
  try {
    const user = await requireApiUser();
    const { searchParams } = new URL(req.url);
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const statusParam = searchParams.get("status");

    const statusValues = Object.values(PublishStatus) as string[];
    if (statusParam && !statusValues.includes(statusParam)) {
      return fail(
        "VALIDATION_ERROR",
        `status must be one of: ${statusValues.join(", ")}`,
        400,
      );
    }

    const scheduledAtUtc: { gte?: Date; lt?: Date } = {};
    if (from) {
      const d = new Date(from);
      if (Number.isNaN(d.getTime())) {
        return fail("VALIDATION_ERROR", "from must be a valid datetime", 400);
      }
      scheduledAtUtc.gte = d;
    }
    if (to) {
      const d = new Date(to);
      if (Number.isNaN(d.getTime())) {
        return fail("VALIDATION_ERROR", "to must be a valid datetime", 400);
      }
      scheduledAtUtc.lt = d;
    }

    const posts = await db.scheduledPost.findMany({
      where: {
        platformContent: { campaign: { userId: user.id } },
        ...(statusParam ? { status: statusParam as PublishStatus } : {}),
        ...(from || to ? { scheduledAtUtc } : {}),
      },
      orderBy: { scheduledAtUtc: "asc" },
      include: {
        platformContent: {
          include: {
            campaign: { select: { id: true, topic: true } },
          },
        },
        socialAccount: {
          select: { id: true, platform: true, accountName: true },
        },
      },
    });

    return ok(posts);
  } catch (err) {
    return authFailureResponse(err) ?? unexpectedError("listing scheduled posts");
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  try {
    const user = await requireApiUser();
    const body: unknown = await req.json().catch(() => null);
    const parsed = scheduleSchema.safeParse(body);
    if (!parsed.success) return validationError(parsed.error);

    const { platformContentId, accountId, websiteId } = parsed.data;

    const content = await db.platformContent.findFirst({
      where: { id: platformContentId },
      include: { campaign: { select: { id: true, userId: true } } },
    });
    if (!content || content.campaign.userId !== user.id) {
      return fail("NOT_FOUND", "Content not found.", 404);
    }

    if (accountId) {
      const account = await db.socialAccount.findFirst({
        where: { id: accountId, userId: user.id },
        select: { id: true },
      });
      if (!account) {
        return fail("NOT_FOUND", "Social account not found.", 404);
      }
    } else if (websiteId) {
      const website = await db.website.findFirst({
        where: { id: websiteId, userId: user.id },
        select: { id: true },
      });
      if (!website) {
        return fail("NOT_FOUND", "Website not found.", 404);
      }
    }

    const scheduledAtUtc = new Date(parsed.data.scheduledAtUtc);
    const idempotencyKey = buildIdempotencyKey({
      campaignId: content.campaign.id,
      platformContentId: content.id,
      accountId: accountId ?? websiteId ?? "",
      contentVersion: content.version,
    });

    const displayTimezone = parsed.data.displayTimezone ?? "Asia/Karachi";

    let post;
    try {
      post = await db.scheduledPost.create({
        data: {
          platformContentId: content.id,
          socialAccountId: accountId ?? null,
          websiteId: websiteId ?? null,
          scheduledAtUtc,
          displayTimezone,
          status: "SCHEDULED",
          idempotencyKey,
        },
        include: {
          platformContent: {
            include: { campaign: { select: { id: true, topic: true } } },
          },
          socialAccount: {
            select: { id: true, platform: true, accountName: true },
          },
        },
      });

      // Honest pipeline progression: the queued content is now SCHEDULED.
      await db.platformContent.update({
        where: { id: content.id },
        data: { status: "SCHEDULED" },
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        // Idempotent retry: the same schedule request already exists.
        const existing = await db.scheduledPost.findUnique({
          where: { idempotencyKey },
          include: {
            platformContent: {
              include: { campaign: { select: { id: true, topic: true } } },
            },
            socialAccount: {
              select: { id: true, platform: true, accountName: true },
            },
          },
        });
        if (existing) return ok(existing);
      }
      throw err;
    }

    await audit({
      userId: user.id,
      actorType: "USER",
      action: AuditActions.POST_SCHEDULED,
      entityType: "ScheduledPost",
      entityId: post.id,
      platform: post.socialAccount?.platform ?? content.platform,
      safeMetadata: {
        scheduledAtUtc: scheduledAtUtc.toISOString(),
        displayTimezone,
        contentVersion: content.version,
        ...(websiteId ? { websiteId } : {}),
      },
    });

    return ok(post, 201);
  } catch (err) {
    return authFailureResponse(err) ?? unexpectedError("scheduling post");
  }
}
