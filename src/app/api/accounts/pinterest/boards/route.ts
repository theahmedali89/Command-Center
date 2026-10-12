// GET /api/accounts/pinterest/boards
// Lists the connected Pinterest account's boards so the user can pick a
// default board for pin publishing.
import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/session";
import { db } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto";
import { listBoards } from "@/providers/social/pinterest";
import type { ApiResponse } from "@/types";

export async function GET(): Promise<NextResponse> {
  let user: { id: string };
  try {
    user = await requireApiUser();
  } catch (err) {
    if (err instanceof Response) return err as NextResponse;
    throw err;
  }

  const account = await db.socialAccount.findFirst({
    where: { userId: user.id, platform: "pinterest" },
  });
  if (!account || !account.encryptedAccessToken) {
    return NextResponse.json(
      {
        ok: false,
        code: "NOT_CONNECTED",
        message: "Pinterest is not connected.",
      } satisfies ApiResponse<never>,
      { status: 400 },
    );
  }

  let accessToken: string;
  try {
    accessToken = decryptSecret(account.encryptedAccessToken);
  } catch {
    return NextResponse.json(
      {
        ok: false,
        code: "AUTH_REQUIRED",
        message: "Stored token could not be decrypted — reconnect Pinterest.",
      } satisfies ApiResponse<never>,
      { status: 401 },
    );
  }

  try {
    const boards = await listBoards(accessToken);
    return NextResponse.json({
      ok: true,
      data: {
        boards,
        selectedBoardId: account.boardId,
        selectedBoardName: account.boardName,
      },
    } satisfies ApiResponse<{
      boards: { id: string; name: string; privacy: string }[];
      selectedBoardId: string | null;
      selectedBoardName: string | null;
    }>);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    if (message === "AUTH_REQUIRED") {
      await db.socialAccount.update({
        where: { id: account.id },
        data: {
          connectionStatus: "AUTH_REQUIRED",
          lastError: "Pinterest token expired — reconnect the account.",
        },
      });
      return NextResponse.json(
        {
          ok: false,
          code: "AUTH_REQUIRED",
          message: "Pinterest token expired — reconnect the account.",
        } satisfies ApiResponse<never>,
        { status: 401 },
      );
    }
    return NextResponse.json(
      {
        ok: false,
        code: "BOARDS_FAILED",
        message: "Could not load Pinterest boards.",
      } satisfies ApiResponse<never>,
      { status: 502 },
    );
  }
}
