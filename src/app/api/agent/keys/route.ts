import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireApiUser } from "@/lib/session";

const createKeySchema = z.object({
  name: z.string().min(1).max(80).optional(),
});

/**
 * Resolve the signed-in dashboard user. requireApiUser throws a 401
 * Response when unauthenticated (session module owned by another worker).
 */
async function apiUser(): Promise<{ id: string } | Response> {
  try {
    return await requireApiUser();
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }
}

/**
 * GET /api/agent/keys — list this user's agent API keys (metadata only).
 * The key hash is NEVER returned.
 */
export async function GET(req: Request): Promise<Response> {
  const user = await apiUser();
  if (user instanceof Response) return user;

  const keys = await db.agentApiKey.findMany({
    where: { userId: user.id },
    select: {
      id: true,
      name: true,
      prefix: true,
      createdAt: true,
      lastUsedAt: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return Response.json({ ok: true, data: keys });
}

/**
 * POST /api/agent/keys — mint a new agent API key.
 * The plaintext token is returned EXACTLY ONCE; only its sha256 hash
 * is stored. It is never logged and never shown again.
 */
export async function POST(req: Request): Promise<Response> {
  const user = await apiUser();
  if (user instanceof Response) return user;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const parsed = createKeySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { ok: false, code: "INVALID_INPUT", message: "Invalid request body." },
      { status: 400 },
    );
  }

  const token = `cc_${randomBytes(32).toString("base64url")}`;
  const keyHash = createHash("sha256").update(token, "utf8").digest("hex");
  const prefix = token.slice(0, 12);

  const key = await db.agentApiKey.create({
    data: {
      userId: user.id,
      name: parsed.data.name ?? "Milo automation",
      keyHash,
      prefix,
    },
  });

  await audit({
    userId: user.id,
    actorType: "USER",
    actorId: user.id,
    action: "AGENT_KEY_CREATED",
    entityType: "AgentApiKey",
    entityId: key.id,
  });

  return Response.json({
    ok: true,
    data: {
      id: key.id,
      name: key.name,
      prefix: key.prefix,
      createdAt: key.createdAt,
      token,
      warning: "Store this token securely — it is shown once and never again.",
    },
  });
}
