import { agentUnauthorized, verifyAgentKey } from "@/lib/agent-auth";
import { db } from "@/lib/db";
import { WordPressClient } from "@/providers/wordpress/client";
import { decryptSecret } from "@/lib/crypto";
import { audit, AuditActions } from "@/lib/audit";

/**
 * PATCH /api/agent/websites/[id]/media/[mediaId]
 * Agent-authenticated media attachment update (alt text).
 *
 * Auth: Authorization: Bearer <agent-api-key>
 * Body: { altText?: string }
 * Returns: { ok, data: { id } }
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; mediaId: string }> },
): Promise<Response> {
  const identity = await verifyAgentKey(req);
  if (!identity) {
    return agentUnauthorized();
  }
  const { id, mediaId } = await params;
  const mediaIdNum = parseInt(mediaId, 10);
  if (isNaN(mediaIdNum)) {
    return Response.json(
      { ok: false, code: "INVALID_ID", message: "Invalid media ID." },
      { status: 400 },
    );
  }

  const website = await db.website.findFirst({
    where: { id, userId: identity.userId },
  });
  if (!website) {
    return Response.json(
      { ok: false, code: "WEBSITE_NOT_FOUND", message: "Website not found." },
      { status: 404 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = null;
  }
  const altText =
    body && typeof (body as Record<string, unknown>).altText === "string"
      ? ((body as Record<string, string>).altText ?? "").trim().slice(0, 500)
      : "";

  const client = new WordPressClient({
    baseUrl: website.url,
    username: website.wpUsername,
    appPassword: decryptSecret(website.encryptedAppPassword),
  });

  try {
    if (altText) {
      await client.setMediaAltText(mediaIdNum, altText);
    }
    await audit({
      userId: identity.userId,
      actorType: "AUTOMATION",
      actorId: "milo-runtime",
      action: AuditActions.MEDIA_UPLOADED,
      entityType: "Website",
      entityId: id,
      platform: "wordpress",
      safeMetadata: { mediaId: mediaIdNum, altTextUpdated: !!altText },
    });
    return Response.json({ ok: true, data: { id: mediaIdNum } });
  } catch (err) {
    return Response.json(
      {
        ok: false,
        code: "UPDATE_FAILED",
        message: err instanceof Error ? err.message : "Update failed.",
      },
      { status: 502 },
    );
  }
}
