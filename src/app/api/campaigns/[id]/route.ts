import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireApiUser } from "@/lib/session";
import {
  ok,
  fail,
  unexpectedError,
  authFailureResponse,
} from "@/lib/api";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteParams): Promise<Response> {
  try {
    const user = await requireApiUser();
    const { id } = await params;

    const campaign = await db.contentCampaign.findFirst({
      where: { id, userId: user.id },
      include: {
        platformContents: {
          orderBy: { platform: "asc" },
          include: {
            mediaAsset: {
              select: {
                id: true,
                originalFilename: true,
                publicUrl: true,
                mimeType: true,
                size: true,
              },
            },
          },
        },
      },
    });

    if (!campaign) {
      return fail("NOT_FOUND", "Campaign not found.", 404);
    }

    return ok(campaign);
  } catch (err) {
    return authFailureResponse(err) ?? unexpectedError("fetching campaign");
  }
}
