import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/session";
import { db } from "@/lib/db";
import { SOCIAL_PROVIDERS } from "@/providers/social";
import type {
  ApiResponse,
  Capability,
  ConnectionStatus,
  PlatformId,
} from "@/types";

export interface AccountRow {
  platform: PlatformId;
  name: string;
  capabilities: Capability[];
  notes: string;
  connected: boolean;
  accountName: string | null;
  connectionStatus: ConnectionStatus;
  lastVerifiedAt: string | null;
  lastError: string | null;
  connectable: boolean;
  connectReason: string | null;
}

export async function GET(): Promise<NextResponse<ApiResponse<AccountRow[]>>> {
  const user = await requireApiUser();

  // Tokens are deliberately never selected — nothing secret leaves the server.
  const accounts = await db.socialAccount.findMany({
    where: { userId: user.id },
    select: {
      platform: true,
      accountName: true,
      connectionStatus: true,
      lastVerifiedAt: true,
      lastError: true,
    },
  });

  const byPlatform = new Map(accounts.map((a) => [a.platform, a]));

  const rows: AccountRow[] = SOCIAL_PROVIDERS.map((meta) => {
    const account = byPlatform.get(meta.id);
    const connected = account?.connectionStatus === "CONNECTED";
    const connectable = meta.id !== "wordpress";
    return {
      platform: meta.id,
      name: meta.name,
      capabilities: meta.capabilities,
      notes: meta.notes,
      connected,
      accountName: account?.accountName ?? null,
      connectionStatus: account?.connectionStatus ?? "NOT_CONFIGURED",
      lastVerifiedAt: account?.lastVerifiedAt?.toISOString() ?? null,
      lastError: account?.lastError ?? null,
      connectable,
      connectReason: connectable
        ? null
        : "WordPress connects via the Sites page using an Application Password.",
    };
  });

  return NextResponse.json({ ok: true, data: rows });
}
