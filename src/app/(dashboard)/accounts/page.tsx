"use client";

import { useCallback, useEffect, useState } from "react";
import { SOCIAL_PROVIDERS } from "@/providers/social";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { StatusBadge } from "@/components/StatusBadge";
import { EmptyState } from "@/components/EmptyState";
import { Skeleton } from "@/components/Skeleton";
import { Badge } from "@/components/Badge";
import { useToast } from "@/components/Toast";
import type { ApiResponse, Capability, ConnectionStatus, PlatformId } from "@/types";

interface AccountRow {
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

async function parseApi<T>(res: Response): Promise<ApiResponse<T>> {
  try {
    return (await res.json()) as ApiResponse<T>;
  } catch {
    return { ok: false, code: "BAD_RESPONSE", message: `Server returned ${res.status}` };
  }
}

export default function AccountsPage() {
  const toast = useToast();
  const [rows, setRows] = useState<AccountRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<PlatformId | null>(null);

  const fetchAccounts = useCallback(async (): Promise<AccountRow[]> => {
    const res = await fetch("/api/accounts");
    const body = await parseApi<AccountRow[]>(res);
    if (!body.ok) throw new Error(body.message);
    return body.data;
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await fetchAccounts());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setLoading(false);
    }
  }, [fetchAccounts]);

  useEffect(() => {
    let cancelled = false;
    fetchAccounts()
      .then((rows) => {
        if (cancelled) return;
        setRows(rows);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Network error");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchAccounts]);

  async function disconnect(platform: PlatformId, name: string) {
    if (!window.confirm(`Disconnect ${name}? Tokens will be removed from the vault.`)) return;
    setBusy(platform);
    try {
      const res = await fetch(`/api/accounts/${platform}`, { method: "DELETE" });
      const body = await parseApi<unknown>(res);
      if (body.ok) {
        toast(`${name} disconnected.`, "success");
        await load();
      } else {
        toast(body.message, "error");
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : "Network error", "error");
    } finally {
      setBusy(null);
    }
  }

  const providerIds = new Set(SOCIAL_PROVIDERS.map((p) => p.id));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Accounts</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Social accounts connected through official APIs. States are verified, never assumed.
        </p>
      </div>

      {loading && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Card key={i}>
              <Skeleton lines={4} />
            </Card>
          ))}
        </div>
      )}

      {!loading && error && (
        <Card>
          <EmptyState
            title="Could not load accounts"
            hint={error}
            action={<Button onClick={load}>Retry</Button>}
          />
        </Card>
      )}

      {!loading && !error && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((row) => (
            <Card key={row.platform} title={row.name}>
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-2">
                  <StatusBadge status={row.connectionStatus} />
                  {row.accountName && (
                    <span className="truncate text-sm text-zinc-600 dark:text-zinc-300">
                      {row.accountName}
                    </span>
                  )}
                </div>

                {row.capabilities.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {row.capabilities.map((c) => (
                      <Badge key={c} tone="gray">
                        {c.replace(/_/g, " ")}
                      </Badge>
                    ))}
                  </div>
                )}

                {row.notes && (
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">{row.notes}</p>
                )}

                {row.lastError && (
                  <p className="text-sm text-red-600 dark:text-red-400">{row.lastError}</p>
                )}

                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Verified: {row.lastVerifiedAt ? new Date(row.lastVerifiedAt).toLocaleString() : "—"}
                </p>

                <div className="mt-1 flex gap-2">
                  {row.connected ? (
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={busy === row.platform}
                      onClick={() => disconnect(row.platform, row.name)}
                    >
                      Disconnect
                    </Button>
                  ) : row.connectable ? (
                    <a
                      href={`/api/oauth/${row.platform}/start`}
                      className="inline-flex h-8 items-center justify-center rounded-lg bg-zinc-900 px-3 text-xs font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
                    >
                      Connect
                    </a>
                  ) : (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled
                      title={row.connectReason ?? "Connection not available for this platform"}
                    >
                      Connect unavailable
                    </Button>
                  )}
                </div>
                {!row.connectable && row.connectReason && !row.connected && (
                  <p className="text-xs text-amber-700 dark:text-amber-400">{row.connectReason}</p>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      {!loading && !error && rows.length === 0 && providerIds.size === 0 && (
        <Card>
          <EmptyState
            title="No platforms available"
            hint="Social providers have not been registered yet."
          />
        </Card>
      )}
    </div>
  );
}
