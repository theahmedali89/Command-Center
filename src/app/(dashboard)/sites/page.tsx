"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { Input } from "@/components/Input";
import { Modal } from "@/components/Modal";
import { StatusBadge } from "@/components/StatusBadge";
import { EmptyState } from "@/components/EmptyState";
import { Skeleton } from "@/components/Skeleton";
import { useToast } from "@/components/Toast";
import type { ApiResponse, ConnectionStatus } from "@/types";

interface WebsiteDto {
  id: string;
  name: string;
  url: string;
  wpUsername: string;
  status: ConnectionStatus;
  lastVerifiedAt: string | null;
  lastError: string | null;
}

async function parseApi<T>(res: Response): Promise<ApiResponse<T>> {
  try {
    return (await res.json()) as ApiResponse<T>;
  } catch {
    return { ok: false, code: "BAD_RESPONSE", message: `Server returned ${res.status}` };
  }
}

export default function SitesPage() {
  const toast = useToast();
  const [websites, setWebsites] = useState<WebsiteDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [username, setUsername] = useState("");
  const [appPassword, setAppPassword] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const fetchSites = useCallback(async (): Promise<WebsiteDto[]> => {
    const res = await fetch("/api/websites");
    const body = await parseApi<WebsiteDto[]>(res);
    if (!body.ok) throw new Error(body.message);
    return body.data;
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setWebsites(await fetchSites());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setLoading(false);
    }
  }, [fetchSites]);

  useEffect(() => {
    let cancelled = false;
    fetchSites()
      .then((sites) => {
        if (cancelled) return;
        setWebsites(sites);
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
  }, [fetchSites]);

  function resetForm() {
    setName("");
    setUrl("");
    setUsername("");
    setAppPassword("");
    setFormError(null);
  }

  async function addWebsite(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !url.trim() || !username.trim() || !appPassword.trim()) {
      setFormError("All fields are required.");
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const res = await fetch("/api/websites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          url: url.trim(),
          wpUsername: username.trim(),
          appPassword,
        }),
      });
      const body = await parseApi<WebsiteDto>(res);
      if (body.ok) {
        setWebsites((prev) => [...prev, body.data]);
        setShowAdd(false);
        resetForm();
        toast("Website added. Verifying connection…", "info");
      } else {
        setFormError(body.message);
      }
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Network error");
    } finally {
      setSaving(false);
    }
  }

  async function verifySite(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/websites/${id}/verify`, { method: "POST" });
      const body = await parseApi<WebsiteDto>(res);
      if (body.ok) {
        setWebsites((prev) => prev.map((w) => (w.id === id ? body.data : w)));
        toast(
          body.data.status === "CONNECTED" ? "Website verified." : `Verification finished: ${body.data.lastError ?? body.data.status}`,
          body.data.status === "CONNECTED" ? "success" : "error"
        );
      } else {
        toast(body.message, "error");
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : "Network error", "error");
    } finally {
      setBusyId(null);
    }
  }

  async function disconnectSite(id: string, siteName: string) {
    if (!window.confirm(`Disconnect "${siteName}"? Its credentials will be removed from the vault.`)) {
      return;
    }
    setBusyId(id);
    try {
      const res = await fetch(`/api/websites/${id}`, { method: "DELETE" });
      const body = await parseApi<unknown>(res);
      if (body.ok) {
        setWebsites((prev) => prev.filter((w) => w.id !== id));
        toast("Website disconnected.", "success");
      } else {
        toast(body.message, "error");
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : "Network error", "error");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Sites</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            WordPress sites connected via Application Password. No browser logins.
          </p>
        </div>
        <Button onClick={() => setShowAdd(true)}>Add Website</Button>
      </div>

      {loading && <Skeleton lines={4} className="max-w-3xl" />}

      {!loading && error && (
        <Card>
          <EmptyState
            title="Could not load websites"
            hint={error}
            action={<Button onClick={load}>Retry</Button>}
          />
        </Card>
      )}

      {!loading && !error && websites.length === 0 && (
        <Card>
          <EmptyState
            title="No websites yet"
            hint="Add your first WordPress site with an Application Password to publish articles via API."
            action={<Button onClick={() => setShowAdd(true)}>Add Website</Button>}
          />
        </Card>
      )}

      {!loading && !error && websites.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          {websites.map((w) => (
            <Card key={w.id} title={w.name} subtitle={w.url}>
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-2">
                  <StatusBadge status={w.status} />
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">
                    Verified: {w.lastVerifiedAt ? new Date(w.lastVerifiedAt).toLocaleString() : "—"}
                  </span>
                </div>
                <p className="text-sm text-zinc-500 dark:text-zinc-400">User: {w.wpUsername}</p>
                {w.lastError && (
                  <p className="text-sm text-red-600 dark:text-red-400">{w.lastError}</p>
                )}
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={busyId === w.id}
                    onClick={() => verifySite(w.id)}
                  >
                    Verify
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    disabled={busyId === w.id}
                    onClick={() => disconnectSite(w.id, w.name)}
                  >
                    Disconnect
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal open={showAdd} title="Add Website" onClose={() => { setShowAdd(false); resetForm(); }}>
        <form onSubmit={addWebsite} className="flex flex-col gap-4">
          <Input
            id="site-name"
            label="Site name"
            placeholder="e.g. FertDose blog"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Input
            id="site-url"
            label="Site URL"
            placeholder="https://example.com"
            inputMode="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <Input
            id="site-username"
            label="WordPress username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <Input
            id="site-app-password"
            label="Application Password"
            type="password"
            placeholder="wp-admin → Users → Profile → Application Passwords"
            value={appPassword}
            onChange={(e) => setAppPassword(e.target.value)}
          />
          {formError && <p className="text-sm text-red-600 dark:text-red-400">{formError}</p>}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => { setShowAdd(false); resetForm(); }}
            >
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              Add &amp; Verify
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
