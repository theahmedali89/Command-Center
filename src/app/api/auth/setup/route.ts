import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { createSession } from "@/lib/session";
import { audit } from "@/lib/audit";

const setupSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(12, "Password must be at least 12 characters."),
  name: z.string().trim().min(1).max(100).optional(),
});

/**
 * First-run bootstrap: creates the initial user and signs them in.
 * Disabled (403) as soon as any user exists — never an open registration.
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, code: "BAD_REQUEST", message: "Invalid JSON body." },
      { status: 400 },
    );
  }

  const parsed = setupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        code: "BAD_REQUEST",
        message: parsed.error.issues.map((i) => i.message).join("; "),
      },
      { status: 400 },
    );
  }

  const existing = await db.user.count();
  if (existing > 0) {
    return NextResponse.json(
      { ok: false, code: "SETUP_DISABLED", message: "Setup is disabled." },
      { status: 403 },
    );
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, 12);
  const user = await db.user.create({
    data: {
      email: parsed.data.email,
      name: parsed.data.name ?? null,
      passwordHash,
    },
    select: { id: true, email: true, name: true },
  });

  await createSession(user);

  await audit({
    userId: user.id,
    actorType: "USER",
    actorId: user.id,
    action: "USER_SETUP",
    entityType: "User",
    entityId: user.id,
  });

  return NextResponse.json({ ok: true });
}
