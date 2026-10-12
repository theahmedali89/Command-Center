import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser } from "@/lib/session";
import { db } from "@/lib/db";
import { audit, AuditActions } from "@/lib/audit";
import { getAIProvider } from "@/providers/ai";
import { validateGenerated } from "@/lib/content-validation";
import { PLATFORMS, type PlatformId } from "@/types";

const optionalUrl = z.preprocess(
  (v) => (v === "" ? undefined : v),
  z.string().trim().url("must be a valid URL").optional(),
);

const generateSchema = z.object({
  topic: z.string().trim().min(3, "topic must be at least 3 characters"),
  context: z.string().trim().optional(),
  goal: z.string().trim().optional(),
  language: z.string().trim().min(1).optional(),
  tone: z.string().trim().min(1).optional(),
  destinationUrl: optionalUrl,
  platforms: z.array(z.enum(PLATFORMS)).min(1, "at least one platform is required"),
  brand: z
    .object({
      name: z.string().trim().optional(),
      websiteUrl: optionalUrl,
      description: z.string().trim().optional(),
    })
    .optional(),
});

type GenerateBody = z.infer<typeof generateSchema>;

function errorResponse(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ ok: false, code, message }, { status });
}

/**
 * POST /api/ai/generate
 * Generates per-platform content for a topic via the AI provider, runs it
 * through the deterministic validation pipeline, and stores it as a DRAFT
 * campaign with one PlatformContent row per platform. Nothing is published.
 */
export async function POST(req: Request): Promise<Response> {
  // requireApiUser throws a 401 Response when unauthenticated (owned by
  // another worker); return it directly instead of letting it bubble.
  let user: { id: string };
  try {
    user = await requireApiUser();
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }

  let body: GenerateBody;
  try {
    const raw: unknown = await req.json();
    const parsed = generateSchema.safeParse(raw);
    if (!parsed.success) {
      const message = parsed.error.issues
        .map((i) => `${i.path.join(".") || "body"}: ${i.message}`)
        .join("; ");
      return errorResponse(400, "INVALID_INPUT", message);
    }
    body = parsed.data;
  } catch {
    return errorResponse(400, "INVALID_INPUT", "Request body must be valid JSON.");
  }

  const platforms = [...new Set(body.platforms)] as PlatformId[];

  // Brand settings are optional: explicit request values win, then the user's
  // saved brand settings, then provider-agnostic defaults.
  const settings = await db.userSettings.findUnique({
    where: { userId: user.id },
    select: {
      brandName: true,
      websiteUrl: true,
      brandDescription: true,
      defaultTone: true,
      defaultLanguage: true,
    },
  });

  const result = await getAIProvider().generate({
    topic: body.topic,
    context: body.context,
    goal: body.goal,
    language: body.language ?? settings?.defaultLanguage ?? "en",
    tone: body.tone ?? settings?.defaultTone ?? "Friendly",
    destinationUrl: body.destinationUrl,
    platforms,
    brand: {
      name: body.brand?.name ?? settings?.brandName ?? undefined,
      websiteUrl: body.brand?.websiteUrl ?? settings?.websiteUrl ?? undefined,
      description: body.brand?.description ?? settings?.brandDescription ?? undefined,
    },
  });

  if (!result.ok) {
    const status = result.code === "AI_NOT_CONFIGURED" ? 503 : 502;
    return errorResponse(status, result.code, result.message);
  }

  const { valid, issues, cleaned } = validateGenerated({
    data: result.data,
    platforms,
  });
  if (!valid) {
    return errorResponse(
      502,
      "AI_GENERATION_FAILED",
      `AI generation incomplete: ${issues.map((i) => i.message).join(" ")}`,
    );
  }

  const campaign = await db.$transaction(async (tx) => {
    const created = await tx.contentCampaign.create({
      data: {
        userId: user.id,
        topic: body.topic,
        context: body.context,
        goal: body.goal,
        language: body.language ?? settings?.defaultLanguage ?? "en",
        tone: body.tone ?? settings?.defaultTone ?? "Friendly",
        destinationUrl: body.destinationUrl,
        status: "DRAFT",
      },
      select: { id: true },
    });
    await tx.platformContent.createMany({
      data: platforms.map((platform) => {
        const c = cleaned[platform] ?? {};
        return {
          campaignId: created.id,
          platform,
          title: c.title,
          hook: c.hook,
          caption: c.caption,
          description: c.description,
          cta: c.cta,
          hashtags: c.hashtags ?? [],
          tags: c.tags ?? [],
          keywords: c.keywords ?? [],
          videoIdea: c.videoIdea,
          version: 1,
          status: "DRAFT",
        };
      }),
    });
    return created;
  });

  // Audit failures are swallowed by audit() so they never break generation.
  await audit({
    userId: user.id,
    actorType: "USER",
    actorId: user.id,
    action: AuditActions.CONTENT_GENERATED,
    entityType: "ContentCampaign",
    entityId: campaign.id,
    safeMetadata: { platforms, issueCount: issues.length },
  });

  return NextResponse.json(
    { ok: true, data: { campaignId: campaign.id, issues } },
    { status: 201 },
  );
}
