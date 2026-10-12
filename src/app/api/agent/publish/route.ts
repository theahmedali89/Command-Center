import { z } from "zod";
import { agentUnauthorized, verifyAgentKey } from "@/lib/agent-auth";
import { executePublish } from "@/services/publishing";

const publishBodySchema = z.object({
  scheduledPostId: z.string().min(1),
});

/**
 * POST /api/agent/publish
 * Agent-authenticated trigger to publish one scheduled post.
 * Idempotent: already-published posts return success without reposting.
 */
export async function POST(req: Request): Promise<Response> {
  const identity = await verifyAgentKey(req);
  if (!identity) {
    return agentUnauthorized();
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json(
      { ok: false, code: "INVALID_INPUT", message: "Request body must be JSON." },
      { status: 400 },
    );
  }

  const parsed = publishBodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { ok: false, code: "INVALID_INPUT", message: "scheduledPostId is required." },
      { status: 400 },
    );
  }

  const result = await executePublish({
    scheduledPostId: parsed.data.scheduledPostId,
    actorType: "AUTOMATION",
    actorId: "milo-runtime",
  });

  return Response.json(result);
}
