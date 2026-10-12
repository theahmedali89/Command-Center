import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { createSession } from "@/lib/session";
import { audit } from "@/lib/audit";

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

/** Same response whether the email exists or the password is wrong. */
function invalidCredentials() {
  return NextResponse.json(
    { ok: false, code: "INVALID_CREDENTIALS", message: "Invalid email or password." },
    { status: 401 },
  );
}

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

  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return invalidCredentials();
  }

  const user = await db.user.findUnique({
    where: { email: parsed.data.email },
    select: { id: true, email: true, name: true, passwordHash: true },
  });
  if (!user) return invalidCredentials();

  const passwordOk = await bcrypt.compare(parsed.data.password, user.passwordHash);
  if (!passwordOk) return invalidCredentials();

  await createSession({ id: user.id, email: user.email, name: user.name });

  await audit({
    userId: user.id,
    actorType: "USER",
    actorId: user.id,
    action: "USER_LOGIN",
    entityType: "User",
    entityId: user.id,
  });

  return NextResponse.json({ ok: true });
}
