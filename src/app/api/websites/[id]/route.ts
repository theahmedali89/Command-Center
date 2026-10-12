import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/session";
import { db } from "@/lib/db";
import { audit, AuditActions } from "@/lib/audit";

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

/** GET /api/websites/[id] — one website (never includes the secret). */
export async function GET(_req: Request, ctx: RouteContext): Promise<Response> {
  const user = await authed();
  if (user instanceof Response) return user;
  const { id } = await ctx.params;

  const website = await db.website.findFirst({
    where: { id, userId: user.id },
    select: websiteSelect,
  });
  if (!website) {
    return NextResponse.json(
      { ok: false, code: "NOT_FOUND", message: "Website not found." },
      { status: 404 }
    );
  }
  return NextResponse.json({ ok: true, data: website });
}

/**
 * DELETE /api/websites/[id] — disconnect. The row is kept for history; only
 * the status flips to DISCONNECTED.
 */
export async function DELETE(_req: Request, ctx: RouteContext): Promise<Response> {
  const user = await authed();
  if (user instanceof Response) return user;
  const { id } = await ctx.params;

  const existing = await db.website.findFirst({
    where: { id, userId: user.id },
    select: { id: true },
  });
  if (!existing) {
    return NextResponse.json(
      { ok: false, code: "NOT_FOUND", message: "Website not found." },
      { status: 404 }
    );
  }

  const website = await db.website.update({
    where: { id },
    data: { status: "DISCONNECTED" },
    select: websiteSelect,
  });

  await audit({
    userId: user.id,
    actorType: "USER",
    actorId: user.id,
    action: AuditActions.WEBSITE_DISCONNECTED,
    entityType: "Website",
    entityId: id,
    platform: "wordpress",
    safeMetadata: { name: website.name, url: website.url },
  });

  return NextResponse.json({ ok: true, data: website });
}
