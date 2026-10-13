import { agentUnauthorized, verifyAgentKey } from "@/lib/agent-auth";
import { db } from "@/lib/db";
import { WordPressClient } from "@/providers/wordpress/client";
import { decryptSecret } from "@/lib/crypto";
import { audit, AuditActions } from "@/lib/audit";

/**
 * POST /api/agent/websites/[id]/media
 * Agent-authenticated media upload to WordPress.
 *
 * Auth: Authorization: Bearer <agent-api-key>
 * Body: multipart/form-data with `file` field (image/*, max 5 MB)
 *       and optional `alt` field (alt text for the attachment, max 500 chars)
 * Returns: { ok, data: { id, url } }
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

  const website = await db.website.findFirst({
    where: { id, userId: identity.userId },
  });
  if (!website) {
    return Response.json(
      { ok: false, code: "WEBSITE_NOT_FOUND", message: "Website not found." },
      { status: 404 },
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json(
      { ok: false, code: "INVALID_FORM", message: "Expected multipart/form-data." },
      { status: 400 },
    );
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json(
      { ok: false, code: "NO_FILE", message: "Missing 'file' field." },
      { status: 400 },
    );
  }
  if (!file.type.startsWith("image/")) {
    return Response.json(
      { ok: false, code: "NOT_IMAGE", message: "Only image/* allowed." },
      { status: 400 },
    );
  }
  if (file.size > 5 * 1024 * 1024) {
    return Response.json(
      { ok: false, code: "TOO_LARGE", message: "Max 5 MB." },
      { status: 400 },
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const client = new WordPressClient({
    baseUrl: website.url,
    username: website.wpUsername,
    appPassword: decryptSecret(website.encryptedAppPassword),
  });

  // Optional alt text for the media attachment (SEO + accessibility).
  const altRaw = form.get("alt");
  const altText = typeof altRaw === "string" ? altRaw.trim().slice(0, 500) : "";

  try {
    const uploaded = await client.uploadMedia(bytes, file.name, file.type);
    // Best-effort: set alt text. Don't fail the upload if this fails.
    if (altText) {
      try {
        await client.setMediaAltText(uploaded.id, altText);
      } catch {
        // Alt text is non-blocking; upload already succeeded.
      }
    }
    await audit({
      userId: identity.userId,
      actorType: "AUTOMATION",
      actorId: "milo-runtime",
      action: AuditActions.MEDIA_UPLOADED,
      entityType: "Website",
      entityId: id,
      platform: "wordpress",
      safeMetadata: { mediaId: uploaded.id },
    });
    return Response.json({ ok: true, data: { id: uploaded.id, url: uploaded.url } });
  } catch (err) {
    return Response.json(
      {
        ok: false,
        code: "UPLOAD_FAILED",
        message: err instanceof Error ? err.message : "Upload failed.",
      },
      { status: 502 },
    );
  }
}
