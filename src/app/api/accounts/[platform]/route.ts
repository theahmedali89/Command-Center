import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser } from "@/lib/session";
import { db } from "@/lib/db";
import { audit, AuditActions } from "@/lib/audit";
import { PLATFORMS, type ApiResponse, type PlatformId } from "@/types";

const platformSchema = z.enum(PLATFORMS);

interface Ctx {
  params: Promise<{ platform: string }>;
}

export async function DELETE(
  _request: Request,
  { params }: Ctx
): Promise<NextResponse<ApiResponse<{ platform: PlatformId }>>> {
  const user = await requireApiUser();
  const { platform } = await params;

  const parsed = platformSchema.safeParse(platform);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, code: "INVALID_PLATFORM", message: `Unknown platform: ${platform}` },
      { status: 400 }
    );
  }
  const platformId = parsed.data;

  const account = await db.socialAccount.findFirst({
    where: { userId: user.id, platform: platformId },
  });

  if (!account) {
    return NextResponse.json(
      {
        ok: false,
        code: "NOT_FOUND",
        message: `No ${platformId} account is tracked for this user.`,
      },
      { status: 404 }
    );
  }

  // Clear every credential; never return them.
  await db.socialAccount.update({
    where: { id: account.id },
    data: {
      encryptedAccessToken: null,
      encryptedRefreshToken: null,
      tokenExpiresAt: null,
      scopes: null,
      externalAccountId: null,
      accountName: null,
      connectionStatus: "DISCONNECTED",
      lastVerifiedAt: null,
      lastError: null,
    },
  });

  await audit({
    userId: user.id,
    actorType: "USER",
    actorId: user.id,
    action: AuditActions.ACCOUNT_DISCONNECTED,
    entityType: "SocialAccount",
    entityId: account.id,
    platform: platformId,
    safeMetadata: { previousAccountName: account.accountName },
  });

  return NextResponse.json({ ok: true, data: { platform: platformId } });
}

const boardSchema = z.object({
  boardId: z.string().min(1).max(64),
  boardName: z.string().min(1).max(200),
});

/**
 * PATCH /api/accounts/[platform]
 * Currently supports setting the default Pinterest board:
 *   { "boardId": "...", "boardName": "..." }
 */
export async function PATCH(
  request: Request,
  { params }: Ctx,
): Promise<NextResponse<ApiResponse<{ platform: PlatformId }>>> {
  const user = await requireApiUser();
  const { platform } = await params;

  const parsed = platformSchema.safeParse(platform);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, code: "INVALID_PLATFORM", message: `Unknown platform: ${platform}` },
      { status: 400 },
    );
  }
  const platformId = parsed.data;

  if (platformId !== "pinterest") {
    return NextResponse.json(
      { ok: false, code: "UNSUPPORTED", message: "Board selection is only supported for Pinterest." },
      { status: 400 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, code: "BAD_REQUEST", message: "Invalid JSON body." },
      { status: 400 },
    );
  }
  const board = boardSchema.safeParse(body);
  if (!board.success) {
    return NextResponse.json(
      { ok: false, code: "BAD_REQUEST", message: "boardId and boardName are required." },
      { status: 400 },
    );
  }

  const account = await db.socialAccount.findFirst({
    where: { userId: user.id, platform: platformId },
  });
  if (!account) {
    return NextResponse.json(
      { ok: false, code: "NOT_FOUND", message: "No Pinterest account is tracked for this user." },
      { status: 404 },
    );
  }

  await db.socialAccount.update({
    where: { id: account.id },
    data: { boardId: board.data.boardId, boardName: board.data.boardName },
  });

  await audit({
    userId: user.id,
    actorType: "USER",
    actorId: user.id,
    action: AuditActions.ACCOUNT_UPDATED,
    entityType: "SocialAccount",
    entityId: account.id,
    platform: platformId,
    safeMetadata: { boardName: board.data.boardName },
  });

  return NextResponse.json({ ok: true, data: { platform: platformId } });
}
