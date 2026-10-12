"use client";

/**
 * Campaign creation form. Posts to /api/ai/generate (owned by the AI worker);
 * on success the user lands on /content. AI-not-configured is shown honestly.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { PLATFORMS, type PlatformId } from "@/types";
import { Card, Input, Textarea, Select, Button } from "@/components";

const GOALS = [
  "Website Traffic",
  "Engagement",
  "Brand Awareness",
  "Educational",
  "Entertainment",
  "Promotion",
];

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

interface GenerateOk {
  ok: true;
  data: { campaignId: string };
}

interface GenerateErr {
  ok: false;
  code: string;
  message: string;
}

export default function CreatePage(): React.ReactElement {
  const router = useRouter();
  const [topic, setTopic] = useState("");
  const [context, setContext] = useState("");
  const [goal, setGoal] = useState(GOALS[0]);
  const [language, setLanguage] = useState("en");
  const [tone, setTone] = useState(TONES[0]);
  const [destinationUrl, setDestinationUrl] = useState("");
  const [platforms, setPlatforms] = useState<Set<PlatformId>>(
    () => new Set(PLATFORMS),
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function togglePlatform(p: PlatformId): void {
    setPlatforms((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);

    if (!topic.trim()) {
      setError("A topic is required.");
      return;
    }
    if (platforms.size === 0) {
      setError("Select at least one platform.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: topic.trim(),
          context: context.trim() || undefined,
          goal,
          language,
          tone,
          destinationUrl: destinationUrl.trim() || undefined,
          platforms: Array.from(platforms),
        }),
      });
      const body = (await res.json().catch(() => null)) as
        | GenerateOk
        | GenerateErr
        | null;
      if (body && body.ok) {
        router.push("/content");
        return;
      }
      const code = body && !body.ok ? body.code : "UNKNOWN";
      const message =
        body && !body.ok && body.message
          ? body.message
          : `Generation failed (HTTP ${res.status}).`;
      if (code === "AI_NOT_CONFIGURED") {
        setError(
          "AI content generation is not configured — no Gemini API key is set on the server. " +
            "Add GEMINI_API_KEY in the deployment environment to enable this, or create a campaign manually from the Content page.",
        );
      } else {
        setError(message);
      }
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-2xl font-bold">Create content</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Describe the topic — the AI writes a tailored version per platform.
        Everything is generated as a draft for your review first.
      </p>

      <Card className="mt-6">
        <form onSubmit={handleSubmit} className="space-y-5 p-5">
          <Input
            label="Topic"
            value={topic}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTopic(e.target.value)}
            placeholder="e.g. NPK fertilizer schedule for wheat in Punjab"
            required
          />

          <Textarea
            label="Context (optional)"
            value={context}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setContext(e.target.value)}
            placeholder="Background, audience, key points to cover…"
            rows={4}
          />

          <div className="grid gap-5 sm:grid-cols-2">
            <Select
              label="Goal"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              options={GOALS.map((g) => ({ label: g, value: g }))}
            />
            <Select
              label="Tone"
              value={tone}
              onChange={(e) => setTone(e.target.value)}
              options={TONES.map((t) => ({ label: t, value: t }))}
            />
            <Select
              label="Language"
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              options={LANGUAGES}
            />
            <Input
              label="Destination URL (optional)"
              type="url"
              value={destinationUrl}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setDestinationUrl(e.target.value)
              }
              placeholder="https://example.com/article"
            />
          </div>

          <fieldset>
            <legend className="text-sm font-medium">Platforms</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {PLATFORMS.map((p) => {
                const active = platforms.has(p);
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => togglePlatform(p)}
                    aria-pressed={active}
                    className={`rounded-full border px-3 py-1.5 text-sm capitalize transition-colors ${
                      active
                        ? "border-blue-600 bg-blue-600 text-white"
                        : "border-zinc-300 text-zinc-600 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-300"
                    }`}
                  >
                    {p}
                  </button>
                );
              })}
            </div>
            <p className="mt-1 text-xs text-zinc-500">
              {platforms.size} of {PLATFORMS.length} selected
            </p>
          </fieldset>

          {error && (
            <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
              {error}
            </p>
          )}

          <Button type="submit" disabled={submitting}>
            {submitting ? "Generating…" : "Generate content"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
