import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser } from "@/lib/session";
import { db } from "@/lib/db";
import { encryptSecret } from "@/lib/crypto";
import { audit, AuditActions } from "@/lib/audit";
import { WordPressClient } from "@/providers/wordpress/client";

const createWebsiteSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(200),
  url: z.string().trim().min(1, "URL is required.").max(500),
  wpUsername: z.string().trim().min(1, "WordPress username is required.").max(200),
  appPassword: z.string().min(1, "Application password is required.").max(500),
});

type ApiUser = { id: string; email: string; name: string | null };

/**
 * Resolve the authenticated user. requireApiUser() throws a 401 Response when
 * unauthenticated; return it directly so the caller short-circuits.
 */
async function authed(): Promise<ApiUser | Response> {
  try {
    return await requireApiUser();
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }
}

/** Normalize a site URL: trim, add https:// when missing, validate. */
function normalizeSiteUrl(raw: string): string | null {
  try {
    let value = raw.trim().replace(/\/+$/, "");
    if (!value) return null;
    if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(value)) value = `https://${value}`;
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return null;
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

/** GET /api/websites — list the user's websites (never includes secrets). */
export async function GET(): Promise<Response> {
  const user = await authed();
  if (user instanceof Response) return user;

  const websites = await db.website.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    select: websiteSelect,
  });
  return NextResponse.json({ ok: true, data: websites });
}

/**
 * POST /api/websites — verify a WordPress site via REST, then store it with
 * the application password encrypted. The password is NEVER stored when
 * verification fails.
 */
export async function POST(req: Request): Promise<Response> {
  const user = await authed();
  if (user instanceof Response) return user;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = null;
  }
  const parsed = createWebsiteSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues
      .map((i) => `${i.path.join(".") || "body"}: ${i.message}`)
      .join("; ");
    return NextResponse.json(
      { ok: false, code: "VALIDATION_ERROR", message },
      { status: 400 }
    );
  }

  const url = normalizeSiteUrl(parsed.data.url);
  if (!url) {
    return NextResponse.json(
      { ok: false, code: "INVALID_URL", message: "Provide a valid http(s) site URL." },
      { status: 400 }
    );
  }

  const client = new WordPressClient({
    baseUrl: url,
    username: parsed.data.wpUsername,
    appPassword: parsed.data.appPassword,
  });
  const verified = await client.verify();
  if (!verified.ok) {
    return NextResponse.json(
      {
        ok: false,
        code: verified.code ?? "VERIFY_FAILED",
        message: verified.message ?? "WordPress verification failed.",
      },
      { status: 400 }
    );
  }

  const website = await db.website.create({
    data: {
      userId: user.id,
      name: parsed.data.name,
      url,
      wpUsername: parsed.data.wpUsername,
      encryptedAppPassword: encryptSecret(parsed.data.appPassword),
      status: "CONNECTED",
      lastVerifiedAt: new Date(),
    },
    select: websiteSelect,
  });

  await audit({
    userId: user.id,
    actorType: "USER",
    actorId: user.id,
    action: AuditActions.WEBSITE_CONNECTED,
    entityType: "Website",
    entityId: website.id,
    platform: "wordpress",
    safeMetadata: {
      url,
      wpUserId: verified.user?.id ?? null,
      wpUserName: verified.user?.name ?? null,
    },
  });

  return NextResponse.json({ ok: true, data: website }, { status: 201 });
}
