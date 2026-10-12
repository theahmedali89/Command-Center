"use client";

/**
 * Settings form: brand, AI defaults, publishing preferences → PUT /api/settings.
 * Below it, the read-only integration status list (booleans only, never values).
 */
import { useState } from "react";
import { Card, Input, Textarea, Select, Button, Badge } from "@/components";
import type { IntegrationStatus } from "@/app/api/settings/integrations/route";

export interface SettingsInitial {
  brandName: string;
  websiteUrl: string;
  brandDescription: string;
  defaultTone: string;
  defaultLanguage: string;
  defaultCta: string;
  defaultTimezone: string;
  approvalRequired: boolean;
}

const TONES = ["Friendly", "Professional", "Playful", "Bold", "Calm", "Authoritative"];

const LANGUAGES = [
  { label: "English", value: "en" },
  { label: "Urdu", value: "ur" },
  { label: "Hindi", value: "hi" },
  { label: "Arabic", value: "ar" },
  { label: "Spanish", value: "es" },
  { label: "French", value: "fr" },
  { label: "German", value: "de" },
];

const TIMEZONES = [
  { label: "Asia/Karachi (PKT)", value: "Asia/Karachi" },
  { label: "Asia/Kolkata (IST)", value: "Asia/Kolkata" },
  { label: "UTC", value: "UTC" },
  { label: "America/New_York", value: "America/New_York" },
  { label: "Europe/London", value: "Europe/London" },
  { label: "Asia/Dubai", value: "Asia/Dubai" },
];

export default function SettingsForm({
  initial,
  integrations,
}: {
  initial: SettingsInitial;
  integrations: IntegrationStatus[];
}): React.ReactElement {
  const [form, setForm] = useState<SettingsInitial>(initial);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof SettingsInitial>(key: K, value: SettingsInitial[K]): void {
    setForm((prev) => ({ ...prev, [key]: value }));
    setSavedAt(null);
  }

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          brandName: form.brandName || undefined,
          websiteUrl: form.websiteUrl || undefined,
          brandDescription: form.brandDescription || undefined,
          defaultCta: form.defaultCta || undefined,
        }),
      });
      const body = (await res.json().catch(() => null)) as {
        ok: boolean;
        message?: string;
      } | null;
      if (body && body.ok) {
        setSavedAt(new Date().toLocaleTimeString());
      } else {
        setError(body?.message ?? `Save failed (HTTP ${res.status}).`);
      }
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-6 space-y-8">
      <Card>
        <form onSubmit={handleSubmit} className="space-y-5 p-5">
          <h2 className="text-base font-semibold">Brand</h2>
          <Input
            label="Brand name"
            value={form.brandName}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              set("brandName", e.target.value)
            }
            placeholder="e.g. Fertilizer Dose"
          />
          <Input
            label="Website URL"
            type="url"
            value={form.websiteUrl}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              set("websiteUrl", e.target.value)
            }
            placeholder="https://example.com"
          />
          <Textarea
            label="Brand description"
            value={form.brandDescription}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
              set("brandDescription", e.target.value)
            }
            placeholder="What the brand is about — used to ground AI-generated content."
            rows={3}
          />

          <h2 className="pt-2 text-base font-semibold">AI defaults</h2>
          <div className="grid gap-5 sm:grid-cols-2">
            <Select
              label="Default tone"
              value={form.defaultTone}
              onChange={(e) => set("defaultTone", e.target.value)}
              options={TONES.map((t) => ({ label: t, value: t }))}
            />
            <Select
              label="Default language"
              value={form.defaultLanguage}
              onChange={(e) => set("defaultLanguage", e.target.value)}
              options={LANGUAGES}
            />
          </div>
          <Input
            label="Default CTA"
            value={form.defaultCta}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              set("defaultCta", e.target.value)
            }
            placeholder="e.g. Read the full guide"
          />

          <h2 className="pt-2 text-base font-semibold">Publishing</h2>
          <div className="grid gap-5 sm:grid-cols-2">
            <Select
              label="Default timezone"
              value={form.defaultTimezone}
              onChange={(e) => set("defaultTimezone", e.target.value)}
              options={TIMEZONES}
            />
          </div>
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              checked={form.approvalRequired}
              onChange={(e) => set("approvalRequired", e.target.checked)}
              className="mt-1 h-4 w-4 rounded border-zinc-300"
            />
            <span>
              <span className="font-medium">Require approval before publishing</span>
              <span className="block text-xs text-zinc-500">
                When enabled, nothing goes live without your explicit approval.
              </span>
            </span>
          </label>

          {error && (
            <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
              {error}
            </p>
          )}
          {savedAt && (
            <p role="status" className="rounded-md bg-green-50 p-3 text-sm text-green-700 dark:bg-green-950 dark:text-green-300">
              Settings saved at {savedAt}.
            </p>
          )}

          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save settings"}
          </Button>
        </form>
      </Card>

      <Card>
        <div className="p-5">
          <h2 className="text-base font-semibold">Integrations</h2>
          <p className="mt-1 text-sm text-zinc-500">
            Read-only. Configure these in the server environment — secret values
            are never shown here.
          </p>
          <ul className="mt-4 divide-y divide-zinc-200 dark:divide-zinc-800">
            {integrations.map((integration) => (
              <li key={integration.id} className="flex items-center justify-between gap-4 py-3">
                <div>
                  <p className="text-sm font-medium">{integration.label}</p>
                  {integration.note && (
                    <p className="mt-0.5 text-xs text-zinc-500">{integration.note}</p>
                  )}
                </div>
                <Badge variant={integration.configured ? "success" : "neutral"}>
                  {integration.configured ? "Configured" : "Not configured"}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      </Card>
    </div>
  );
}
