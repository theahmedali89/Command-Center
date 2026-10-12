import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireApiUser } from "@/lib/session";
import { getStorage } from "@/lib/storage";
import { audit } from "@/lib/audit";
import {
  ok,
  fail,
  unexpectedError,
  authFailureResponse,
} from "@/lib/api";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function DELETE(_req: NextRequest, { params }: RouteParams): Promise<Response> {
  try {
    const user = await requireApiUser();
    const { id } = await params;

    const asset = await db.mediaAsset.findFirst({
      where: { id, userId: user.id },
    });
    if (!asset) {
      return fail("NOT_FOUND", "Media asset not found.", 404);
    }

    // Best effort: remove the object from storage. If storage is not
    // configured (or the object is already gone), the DB row is still
    // removed so the library stays honest about what exists.
    try {
      await getStorage().delete(asset.storageKey);
    } catch (err) {
      console.error(`[api] storage delete failed for ${asset.storageKey}:`, err);
    }

    await db.mediaAsset.delete({ where: { id: asset.id } });

    await audit({
      userId: user.id,
      actorType: "USER",
      action: "MEDIA_DELETED",
      entityType: "MediaAsset",
      entityId: asset.id,
      safeMetadata: { filename: asset.originalFilename },
    });

    return ok({ id: asset.id });
  } catch (err) {
    return authFailureResponse(err) ?? unexpectedError("deleting media asset");
  }
}
