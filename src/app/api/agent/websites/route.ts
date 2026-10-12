import { db } from "@/lib/db";
import { agentUnauthorized, verifyAgentKey } from "@/lib/agent-auth";

/**
 * GET /api/agent/websites
 * Lists the key owner's websites WITHOUT secrets (no app passwords ever).
 */
export async function GET(req: Request): Promise<Response> {
  const identity = await verifyAgentKey(req);
  if (!identity) {
    return agentUnauthorized();
  }

  const websites = await db.website.findMany({
    where: { userId: identity.userId },
    select: {
      id: true,
      name: true,
      url: true,
      status: true,
      lastVerifiedAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  return Response.json({ ok: true, data: websites });
}
