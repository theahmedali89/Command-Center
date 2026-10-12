import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireApiUser } from "@/lib/session";
import { audit } from "@/lib/audit";
import {
  ok,
  fail,
  validationError,
  unexpectedError,
  authFailureResponse,
} from "@/lib/api";

const settingsSchema = z.object({
  brandName: z.string().trim().max(120).optional(),
  websiteUrl: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.string().url("websiteUrl must be a valid URL").optional(),
  ),
  brandDescription: z.string().trim().max(2000).optional(),
  defaultTone: z.string().trim().min(1).max(60).optional(),
  defaultLanguage: z.string().trim().min(1).max(16).optional(),
  defaultCta: z.string().trim().max(200).optional(),
  defaultTimezone: z.string().trim().min(1).max(64).optional(),
  approvalRequired: z.boolean().optional(),
});

export async function GET(): Promise<Response> {
  try {
    const user = await requireApiUser();
    const settings = await db.userSettings.findUnique({
      where: { userId: user.id },
    });
    if (!settings) {
      return fail("NOT_CONFIGURED", "No settings saved yet.", 404);
    }
    return ok(settings);
  } catch (err) {
    return authFailureResponse(err) ?? unexpectedError("reading settings");
  }
}

export async function PUT(req: NextRequest): Promise<Response> {
  try {
    const user = await requireApiUser();
    const body: unknown = await req.json().catch(() => null);
    const parsed = settingsSchema.safeParse(body);
    if (!parsed.success) return validationError(parsed.error);

    const settings = await db.userSettings.upsert({
      where: { userId: user.id },
      create: { userId: user.id, ...parsed.data },
      update: parsed.data,
    });

    await audit({
      userId: user.id,
      actorType: "USER",
      action: "SETTINGS_UPDATED",
      entityType: "UserSettings",
      entityId: settings.id,
    });

    return ok(settings);
  } catch (err) {
    return authFailureResponse(err) ?? unexpectedError("saving settings");
  }
}
