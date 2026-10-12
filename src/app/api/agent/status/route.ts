import { db } from "@/lib/db";
import { agentUnauthorized, verifyAgentKey } from "@/lib/agent-auth";
import { PublishStatus } from "@/types";

/**
 * GET /api/agent/status
 * Aggregate health snapshot for the agent: connection counts, due-now
 * queue depth, and failed posts needing attention.
 */
export async function GET(req: Request): Promise<Response> {
  const identity = await verifyAgentKey(req);
  if (!identity) {
    return agentUnauthorized();
  }

  const now = new Date();
  const userId = identity.userId;
  const postScope = { platformContent: { campaign: { userId } } };

  const [websiteCounts, accountCounts, dueNow, failed] = await Promise.all([
    db.website.groupBy({
      by: ["status"],
      where: { userId },
      _count: { _all: true },
    }),
    db.socialAccount.groupBy({
      by: ["connectionStatus"],
      where: { userId },
      _count: { _all: true },
    }),
    db.scheduledPost.count({
      where: {
        ...postScope,
        OR: [
          { status: PublishStatus.SCHEDULED, scheduledAtUtc: { lte: now } },
          {
            status: PublishStatus.FAILED,
            scheduledAtUtc: { lte: now },
            nextRetryAt: { lte: now },
          },
        ],
      },
    }),
    db.scheduledPost.count({
      where: { ...postScope, status: PublishStatus.FAILED },
    }),
  ]);

  const websites: Record<string, number> = {};
  for (const row of websiteCounts) {
    websites[row.status] = row._count._all;
  }

  const accounts: Record<string, number> = {};
  for (const row of accountCounts) {
    accounts[row.connectionStatus] = row._count._all;
  }

  return Response.json({
    ok: true,
    data: { websites, accounts, dueNow, failed },
  });
}
