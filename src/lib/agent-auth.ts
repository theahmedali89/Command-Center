import { createHash, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";

export interface AgentIdentity {
  userId: string;
  keyId: string;
}

/**
 * Verify the Authorization: Bearer <token> agent API key.
 * Returns the identity on success, null on any failure.
 * Tokens are never logged or stored — only their sha256 hash is compared.
 */
export async function verifyAgentKey(req: Request): Promise<AgentIdentity | null> {
  const header = req.headers.get("authorization");
  if (!header || !header.toLowerCase().startsWith("bearer ")) {
    return null;
  }
  const token = header.slice(7).trim();
  if (token.length === 0) {
    return null;
  }

  const prefix = token.slice(0, 12);
  const record = await db.agentApiKey.findFirst({ where: { prefix } });
  if (!record) {
    return null;
  }

  const presented = createHash("sha256").update(token, "utf8").digest();
  const stored = Buffer.from(record.keyHash, "hex");
  if (presented.length !== stored.length || !timingSafeEqual(presented, stored)) {
    return null;
  }

  // Fire-and-forget: never block the request on bookkeeping.
  void db.agentApiKey
    .update({ where: { id: record.id }, data: { lastUsedAt: new Date() } })
    .catch(() => undefined);

  return { userId: record.userId, keyId: record.id };
}

/** Standard 401 for agent endpoints. Carries no token or secret detail. */
export function agentUnauthorized(): Response {
  return Response.json(
    { ok: false, code: "INVALID_AGENT_KEY", message: "Invalid or missing agent API key." },
    { status: 401 },
  );
}
