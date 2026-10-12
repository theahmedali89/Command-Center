import { agentUnauthorized, verifyAgentKey } from "@/lib/agent-auth";
import { runDuePosts } from "@/services/scheduler";

/**
 * POST /api/agent/run-due
 * Agent-authenticated trigger: publish everything due now (scheduled +
 * retryable failures). Milo's runtime cron calls this on its tick.
 */
export async function POST(req: Request): Promise<Response> {
  const identity = await verifyAgentKey(req);
  if (!identity) {
    return agentUnauthorized();
  }

  const result = await runDuePosts();

  return Response.json({ ok: true, data: result });
}
