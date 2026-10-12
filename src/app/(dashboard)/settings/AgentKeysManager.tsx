"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { useToast } from "@/components/Toast";

interface AgentKey {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
}

/**
 * Agent API key management. Keys authenticate Milo's publishing crons
 * against /api/agent/* — the token is shown exactly once at creation.
 */
export function AgentKeysManager() {
  const toast = useToast();
  const [keys, setKeys] = useState<AgentKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [name, setName] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/agent/keys");
      const body = (await res.json()) as { ok: boolean; data?: AgentKey[] };
      if (body.ok && body.data) setKeys(body.data);
    } catch {
      // Non-fatal; the section just stays empty.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function createKey() {
    setCreating(true);
    setNewToken(null);
    try {
      const res = await fetch("/api/agent/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() || "Milo automation" }),
      });
      const body = (await res.json()) as {
        ok: boolean;
        data?: { token: string };
        message?: string;
      };
      if (!body.ok || !body.data?.token) {
        throw new Error(body.message ?? "Could not create key.");
      }
      setNewToken(body.data.token);
      setName("");
      await load();
      toast("API key created — copy it now, it won't be shown again.", "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not create key.", "error");
    } finally {
      setCreating(false);
    }
  }

  async function revoke(id: string, keyName: string) {
    if (!window.confirm(`Revoke "${keyName}"? Connected automations will stop working.`)) return;
    try {
      const res = await fetch(`/api/agent/keys?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      const body = (await res.json()) as { ok: boolean; message?: string };
      if (!body.ok) throw new Error(body.message ?? "Could not revoke key.");
      await load();
      toast("API key revoked.", "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not revoke key.", "error");
    }
  }

  return (
    <Card title="Agent API keys">
      <div className="flex flex-col gap-3">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Keys for automation (publishing crons) calling{" "}
          <code className="text-xs">/api/agent/*</code>. The token is shown once —
          store it securely.
        </p>

        {newToken && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950">
            <p className="text-xs font-medium text-amber-800 dark:text-amber-200">
              Copy this token now — it will never be shown again:
            </p>
            <code className="mt-1 block break-all text-sm text-zinc-900 dark:text-zinc-100">
              {newToken}
            </code>
          </div>
        )}

        <div className="flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Key name (e.g. Milo automation)"
            maxLength={80}
            className="h-9 min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
          <Button size="sm" disabled={creating} onClick={createKey}>
            {creating ? "Creating…" : "Create key"}
          </Button>
        </div>

        {loading ? (
          <p className="text-xs text-zinc-500">Loading keys…</p>
        ) : keys.length === 0 ? (
          <p className="text-xs text-zinc-500">No API keys yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {keys.map((k) => (
              <li
                key={k.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-800"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{k.name}</p>
                  <p className="text-xs text-zinc-500">
                    <code>{k.prefix}…</code> · created{" "}
                    {new Date(k.createdAt).toLocaleDateString()}
                    {k.lastUsedAt
                      ? ` · last used ${new Date(k.lastUsedAt).toLocaleDateString()}`
                      : " · never used"}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => revoke(k.id, k.name)}
                >
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
