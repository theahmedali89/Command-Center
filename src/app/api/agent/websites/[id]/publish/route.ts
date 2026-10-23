import { agentUnauthorized, verifyAgentKey } from "@/lib/agent-auth";
import {
  publishToWebsite,
  websitePublishSchema,
} from "@/services/website-publish";

/**
 * POST /api/agent/websites/[id]/publish
 * Agent-authenticated WordPress publish (or draft). This is the endpoint
 * Milo's publishing crons call instead of driving a browser: same
 * validation, capability detection, and audit trail as the dashboard route,
 * attributed to the AUTOMATION actor.
 *
 * Auth: Authorization: Bearer <agent-api-key>
 * Body: { title, html, slug?, status?, category?, tags?, featuredMediaUrl?,
 *         featuredMediaAlt?, yoastTitle?, yoastDescription?, yoastFocusKw? }
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const identity = await verifyAgentKey(req);
  if (!identity) {
    return agentUnauthorized();
  }
  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = null;
  }
  const parsed = websitePublishSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues
      .map((i) => `${i.path.join(".") || "body"}: ${i.message}`)
      .join("; ");
    return Response.json(
      { ok: false, code: "VALIDATION_ERROR", message },
      { status: 400 },
    );
  }

  const result = await publishToWebsite({
    websiteId: id,
    userId: identity.userId,
    input: parsed.data,
    actorType: "AUTOMATION",
    actorId: "milo-runtime",
  });

  if (!result.ok) {
    return Response.json(
      { ok: false, code: result.code, message: result.message },
      { status: result.httpStatus },
    );
  }
  return Response.json({
    ok: true,
    data: {
      postId: result.postId,
      url: result.url,
      yoastApplied: result.yoastApplied ?? false,
    },
  });
}
