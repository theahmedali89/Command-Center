import { NextResponse } from "next/server";
import { destroySession, getSessionUser } from "@/lib/session";
import { audit } from "@/lib/audit";

export async function POST() {
  // Capture the user before the cookie is destroyed, for the audit record.
  const user = await getSessionUser();
  await destroySession();

  if (user) {
    await audit({
      userId: user.id,
      actorType: "USER",
      actorId: user.id,
      action: "USER_LOGOUT",
      entityType: "User",
      entityId: user.id,
    });
  }

  return NextResponse.json({ ok: true });
}
