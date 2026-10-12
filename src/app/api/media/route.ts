import { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { requireApiUser } from "@/lib/session";
import { getStorage, isStorageError } from "@/lib/storage";
import { audit, AuditActions } from "@/lib/audit";
import {
  ok,
  fail,
  unexpectedError,
  authFailureResponse,
} from "@/lib/api";

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB

/** Strip anything that could be unsafe in a storage key / filename. */
function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "file";
  const cleaned = base.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned.slice(0, 120) || "file";
}

export async function GET(): Promise<Response> {
  try {
    const user = await requireApiUser();
    const assets = await db.mediaAsset.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
    });
    return ok(assets);
  } catch (err) {
    return authFailureResponse(err) ?? unexpectedError("listing media assets");
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  try {
    const user = await requireApiUser();

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return fail("VALIDATION_ERROR", "Expected multipart form data.", 400);
    }

    const file = form.get("file");
    if (!(file instanceof File)) {
      return fail("VALIDATION_ERROR", 'A "file" field is required.', 400);
    }
    if (file.size === 0) {
      return fail("VALIDATION_ERROR", "The uploaded file is empty.", 400);
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return fail(
        "FILE_TOO_LARGE",
        `File is ${(file.size / 1024 / 1024).toFixed(1)} MB — the limit is 25 MB.`,
        413,
      );
    }
    const mimeType = file.type || "application/octet-stream";
    const isImage = mimeType.startsWith("image/");
    const isVideo = mimeType.startsWith("video/");
    if (!isImage && !isVideo) {
      return fail(
        "UNSUPPORTED_TYPE",
        "Only image/* and video/* files are supported.",
        415,
      );
    }

    const filename = sanitizeFilename(file.name || "upload");
    const key = `media/${user.id}/${randomUUID()}-${filename}`;

    let url: string;
    try {
      const storage = getStorage();
      const data = new Uint8Array(await file.arrayBuffer());
      const result = await storage.upload(key, data, mimeType);
      url = result.url;
    } catch (err) {
      if (isStorageError(err) && err.code === "NOT_CONFIGURED") {
        return fail(
          "NOT_CONFIGURED",
          "Media storage is not configured (Cloudflare R2 credentials are missing). Upload is unavailable until it is set up.",
          503,
        );
      }
      throw err;
    }

    const asset = await db.mediaAsset.create({
      data: {
        userId: user.id,
        type: isImage ? "image" : "video",
        originalFilename: filename,
        storageProvider: "r2",
        storageKey: key,
        publicUrl: url,
        mimeType,
        size: file.size,
      },
    });

    await audit({
      userId: user.id,
      actorType: "USER",
      action: AuditActions.MEDIA_UPLOADED,
      entityType: "MediaAsset",
      entityId: asset.id,
      safeMetadata: { filename, mimeType, size: file.size },
    });

    return ok(asset, 201);
  } catch (err) {
    return authFailureResponse(err) ?? unexpectedError("uploading media");
  }
}
