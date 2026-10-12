import { NextResponse } from "next/server";
import type { ConnectionStatus } from "@prisma/client";
import { requireApiUser } from "@/lib/session";
import { db } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto";
import { audit, AuditActions } from "@/lib/audit";
import { WordPressClient } from "@/providers/wordpress/client";

type ApiUser = { id: string; email: string; name: string | null };
type RouteContext = { params: Promise<{ id: string }> };

async function authed(): Promise<ApiUser | Response> {
  try {
    return await requireApiUser();
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }
}

const websiteSelect = {
  id: true,
  name: true,
  url: true,
  status: true,
  lastVerifiedAt: true,
  lastError: true,
} as const;

/** Map a verification failure onto the honest connection-state model. */
function statusForFailure(code: string | undefined): ConnectionStatus {
  switch (code) {
    case "AUTH_REQUIRED":
      return "AUTH_REQUIRED";
    case "BLOCKED":
      return "BLOCKED";
    case "NOT_CONFIGURED":
      return "NOT_CONFIGURED";
    default:
      return "RECONNECT_REQUIRED";
  }
}

/**
 * POST /api/websites/[id]/verify — re-verify with the stored (decrypted)
 * application password and update the connection state honestly.
 */
export async function POST(_req: Request, ctx: RouteContext): Promise<Response> {
  const user = await authed();
  if (user instanceof Response) return user;
  const { id } = await ctx.params;

  const website = await db.website.findFirst({ where: { id, userId: user.id } });
  if (!website) {
    return NextResponse.json(
      { ok: false, code: "NOT_FOUND", message: "Website not found." },
      { status: 404 }
    );
  }

  const client = new WordPressClient({
    baseUrl: website.url,
    username: website.wpUsername,
    appPassword: decryptSecret(website.encryptedAppPassword),
  });
  const result = await client.verify();

  if (result.ok) {
    const updated = await db.website.update({
      where: { id },
      data: { status: "CONNECTED", lastVerifiedAt: new Date(), lastError: null },
      select: websiteSelect,
    });
    await audit({
      userId: user.id,
      actorType: "USER",
      actorId: user.id,
      action: AuditActions.WEBSITE_CONNECTED,
      entityType: "Website",
      entityId: id,
      platform: "wordpress",
      safeMetadata: {
        url: website.url,
        reverified: true,
        wpUserName: result.user?.name ?? null,
      },
    });
    return NextResponse.json({ ok: true, data: updated });
  }

  const status = statusForFailure(result.code);
  const message = result.message ?? "WordPress verification failed.";
  const updated = await db.website.update({
    where: { id },
    data: { status, lastError: message },
    select: websiteSelect,
  });
  await audit({
    userId: user.id,
    actorType: "USER",
    actorId: user.id,
    action: "WEBSITE_VERIFY_FAILED",
    entityType: "Website",
    entityId: id,
    platform: "wordpress",
    safeMetadata: { url: website.url, code: result.code ?? "VERIFY_FAILED" },
  });
  return NextResponse.json(
    { ok: false, code: result.code ?? "VERIFY_FAILED", message, data: updated },
    { status: 400 }
  );
}
