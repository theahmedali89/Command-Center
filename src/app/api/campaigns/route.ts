import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireApiUser } from "@/lib/session";
import { audit, AuditActions } from "@/lib/audit";
import { CampaignStatus } from "@/types";
import {
  ok,
  fail,
  validationError,
  unexpectedError,
  authFailureResponse,
} from "@/lib/api";

const createCampaignSchema = z.object({
  topic: z.string().trim().min(1, "topic is required").max(300),
  context: z.string().trim().max(5000).optional(),
  goal: z.string().trim().max(120).optional(),
  language: z.string().trim().max(16).optional(),
  tone: z.string().trim().max(60).optional(),
  destinationUrl: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.string().url("destinationUrl must be a valid URL").optional(),
  ),
});

export async function GET(req: NextRequest): Promise<Response> {
  try {
    const user = await requireApiUser();
    const { searchParams } = new URL(req.url);
    const statusParam = searchParams.get("status");
    const search = searchParams.get("search")?.trim();

    const statusValues = Object.values(CampaignStatus) as string[];
    if (statusParam && !statusValues.includes(statusParam)) {
      return fail(
        "VALIDATION_ERROR",
        `status must be one of: ${statusValues.join(", ")}`,
        400,
      );
    }

    const campaigns = await db.contentCampaign.findMany({
      where: {
        userId: user.id,
        ...(statusParam ? { status: statusParam as CampaignStatus } : {}),
        ...(search
          ? {
              OR: [
                { topic: { contains: search, mode: "insensitive" } },
                { context: { contains: search, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      include: {
        platformContents: {
          orderBy: { platform: "asc" },
        },
      },
    });

    return ok(campaigns);
  } catch (err) {
    return authFailureResponse(err) ?? unexpectedError("listing campaigns");
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  try {
    const user = await requireApiUser();
    const body: unknown = await req.json().catch(() => null);
    const parsed = createCampaignSchema.safeParse(body);
    if (!parsed.success) return validationError(parsed.error);

    const campaign = await db.contentCampaign.create({
      data: {
        userId: user.id,
        topic: parsed.data.topic,
        context: parsed.data.context,
        goal: parsed.data.goal,
        language: parsed.data.language ?? "en",
        tone: parsed.data.tone ?? "Friendly",
        destinationUrl: parsed.data.destinationUrl,
        status: "DRAFT",
      },
      include: { platformContents: true },
    });

    await audit({
      userId: user.id,
      actorType: "USER",
      action: AuditActions.CONTENT_GENERATED,
      entityType: "ContentCampaign",
      entityId: campaign.id,
      safeMetadata: { topic: campaign.topic, goal: campaign.goal ?? null },
    });

    return ok(campaign, 201);
  } catch (err) {
    return authFailureResponse(err) ?? unexpectedError("creating campaign");
  }
}
