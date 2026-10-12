import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/session";
import {
  publishToWebsite,
  websitePublishSchema,
} from "@/services/website-publish";

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

/**
 * POST /api/websites/[id]/publish — publish (or draft) a post to a connected
 * WordPress site. Capability-detected Yoast handling, server-side featured
 * image fetch with a 5 MB cap, every outcome audited.
 * (Core logic lives in services/website-publish.ts, shared with the agent route.)
 */
export async function POST(req: Request, ctx: RouteContext): Promise<Response> {
  const user = await authed();
  if (user instanceof Response) return user;
  const { id } = await ctx.params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = null;
  }
  const parsed = websitePublishSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues
      .map((i) => `${i.path.join(".") || "body"}: ${i.message}`)
      .join("; ");
    return NextResponse.json(
      { ok: false, code: "VALIDATION_ERROR", message },
      { status: 400 },
    );
  }

  const result = await publishToWebsite({
    websiteId: id,
    userId: user.id,
    input: parsed.data,
    actorType: "USER",
    actorId: user.id,
  });

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, code: result.code, message: result.message },
      { status: result.httpStatus },
    );
  }
  return NextResponse.json({
    ok: true,
    data: {
      postId: result.postId,
      url: result.url,
      yoastApplied: result.yoastApplied ?? false,
    },
  });
}
