import { getEnv } from "@/lib/env";
import type {
  AIProvider,
  GenerateInput,
  GenerateResult,
  PlatformGenerated,
} from "./types";

/**
 * Gemini model used for content generation.
 * Changeable via the GEMINI_MODEL environment variable; falls back to
 * gemini-2.0-flash. Callers must not rely on a specific model name.
 */
const DEFAULT_MODEL = "gemini-2.0-flash";
const GENERATE_TIMEOUT_MS = 90_000;

/** Per-platform raw JSON shape requested from the model. */
const PLATFORM_SHAPES: Record<string, string> = {
  facebook: '{ "post": "full post text", "cta": "call to action", "hashtags": ["#tag1", "#tag2"] }',
  instagram: '{ "hook": "first line hook", "caption": "full caption", "cta": "call to action", "hashtags": ["#tag1"] }',
  youtube: '{ "title": "video title", "description": "video description", "tags": ["tag1", "tag2"], "videoIdea": "one-paragraph video concept" }',
  tiktok: '{ "hook": "opening hook line", "caption": "caption text", "hashtags": ["#tag1"], "videoIdea": "one-paragraph video concept" }',
  pinterest: '{ "title": "pin title", "description": "pin description", "keywords": ["keyword1", "keyword2"] }',
  x: '{ "post": "post text (max 280 chars)", "hashtags": ["#tag1"] }',
  threads: '{ "post": "post text", "hashtags": ["#tag1"] }',
  telegram: '{ "post": "message text" }',
  tumblr: '{ "title": "post title", "post": "post body", "tags": ["tag1", "tag2"] }',
  bluesky: '{ "post": "post text (max 300 chars)", "hashtags": ["#tag1"] }',
  linkedin: '{ "post": "professional post text", "hashtags": ["#tag1"] }',
  wordpress: '{ "title": "article title", "excerpt": "article excerpt", "outline": ["section 1", "section 2"] }',
};

/** Maps each platform's raw JSON keys onto PlatformGenerated fields. */
const FIELD_MAP: Record<string, Record<string, keyof PlatformGenerated>> = {
  facebook: { post: "caption", cta: "cta", hashtags: "hashtags" },
  instagram: { hook: "hook", caption: "caption", cta: "cta", hashtags: "hashtags" },
  youtube: { title: "title", description: "description", tags: "tags", videoIdea: "videoIdea" },
  tiktok: { hook: "hook", caption: "caption", hashtags: "hashtags", videoIdea: "videoIdea" },
  pinterest: { title: "title", description: "description", keywords: "keywords" },
  x: { post: "caption", hashtags: "hashtags" },
  threads: { post: "caption", hashtags: "hashtags" },
  telegram: { post: "caption" },
  tumblr: { title: "title", post: "caption", tags: "tags" },
  bluesky: { post: "caption", hashtags: "hashtags" },
  linkedin: { post: "caption", hashtags: "hashtags" },
  // wordpress outline (string[]) is joined into videoIdea by mapPlatform below.
  wordpress: { title: "title", excerpt: "description" },
};

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item): item is string => typeof item === "string")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Normalize one platform's raw JSON object into PlatformGenerated. */
function mapPlatform(platform: string, raw: unknown): PlatformGenerated {
  const out: PlatformGenerated = {};
  if (!isRecord(raw)) return out;
  const mapping = FIELD_MAP[platform];
  if (!mapping) return out;
  for (const [rawKey, field] of Object.entries(mapping)) {
    const value = raw[rawKey];
    if (field === "hashtags" || field === "tags" || field === "keywords") {
      if (isStringArray(value)) out[field] = value;
    } else if (isString(value)) {
      out[field] = value;
    }
  }
  // WordPress outline (string[]) is mapped onto videoIdea above; join it for readability.
  if (platform === "wordpress" && isStringArray(raw["outline"])) {
    out.videoIdea = raw["outline"].join("\n");
  }
  return out;
}

function buildPrompt(input: GenerateInput): string {
  const brand = input.brand;
  const brandLine = brand?.name
    ? `Brand: ${brand.name}${brand.description ? ` — ${brand.description}` : ""}${brand.websiteUrl ? ` (${brand.websiteUrl})` : ""}`
    : "";
  const platformSections = input.platforms
    .map((p) => `"${p}": ${PLATFORM_SHAPES[p] ?? '{ "post": "post text" }'}`)
    .join(",\n  ");

  return `You are a social media copywriter. Generate platform-native content (never copy-paste the same text across platforms) for the topic below.

Topic: ${input.topic}
${input.context ? `Context: ${input.context}\n` : ""}${input.goal ? `Goal: ${input.goal}\n` : ""}Language: ${input.language}
Tone: ${input.tone}
${input.destinationUrl ? `Link to reference naturally where the platform supports links: ${input.destinationUrl}\n` : ""}${brandLine ? `${brandLine}\n` : ""}
Quality rules: no keyword stuffing, no invented statistics or claims, no engagement bait, no excessive hashtags. Respect these hard limits: title ≤ 120 characters, hook ≤ 280 characters, caption ≤ 2200 characters, description ≤ 5000 characters, at most 30 hashtags per platform, each hashtag matching ^#[A-Za-z0-9_]+.

Respond with ONLY a JSON object (no markdown fences, no commentary) with exactly these top-level keys, one per requested platform:
{
  ${platformSections}
}`;
}

/** Extract the JSON payload from a model response (first "{" to last "}"). */
function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("No JSON object found in AI response");
  }
  return JSON.parse(text.slice(start, end + 1));
}

interface GeminiPart {
  text?: string;
}
interface GeminiCandidate {
  content?: { parts?: GeminiPart[] };
}
interface GeminiApiResponse {
  candidates?: GeminiCandidate[];
  error?: { message?: string; code?: number };
}

function isGeminiApiResponse(value: unknown): value is GeminiApiResponse {
  return isRecord(value);
}

export const geminiProvider: AIProvider = {
  id: "gemini",

  async generate(input: GenerateInput): Promise<GenerateResult> {
    // getEnv() is called inside the function (never at module scope) so the
    // server can boot without the key; generation fails honestly instead.
    const apiKey = getEnv().GEMINI_API_KEY;
    if (!apiKey) {
      return {
        ok: false,
        code: "AI_NOT_CONFIGURED",
        message:
          "Gemini API key is not configured. Set GEMINI_API_KEY to enable AI content generation.",
      };
    }

    const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), GENERATE_TIMEOUT_MS);

    try {
      const res = await fetch(url, {
        method: "POST",
        // The key travels in a header, never in the URL, so it cannot leak
        // into logs via request URLs.
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: buildPrompt(input) }] }],
          generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.7,
          },
        }),
        signal: controller.signal,
      });

      const body: unknown = await res.json().catch(() => null);

      if (!res.ok) {
        const message =
          isGeminiApiResponse(body) && isString(body.error?.message)
            ? body.error.message
            : `Gemini API request failed with status ${res.status}`;
        return { ok: false, code: "AI_GENERATION_FAILED", message };
      }

      if (!isGeminiApiResponse(body) || !Array.isArray(body.candidates)) {
        return {
          ok: false,
          code: "AI_GENERATION_FAILED",
          message: "Gemini API returned an unexpected response shape.",
        };
      }

      const text = (body.candidates[0]?.content?.parts ?? [])
        .map((part) => (isString(part.text) ? part.text : ""))
        .join("");
      if (!text.trim()) {
        return {
          ok: false,
          code: "AI_GENERATION_FAILED",
          message: "Gemini API returned an empty response.",
        };
      }

      let parsed: unknown;
      try {
        parsed = extractJson(text);
      } catch {
        return {
          ok: false,
          code: "AI_GENERATION_FAILED",
          message: "AI response was not valid JSON.",
        };
      }
      if (!isRecord(parsed)) {
        return {
          ok: false,
          code: "AI_GENERATION_FAILED",
          message: "AI response was not a JSON object.",
        };
      }

      const data: Record<string, PlatformGenerated> = {};
      for (const platform of input.platforms) {
        data[platform] = mapPlatform(platform, parsed[platform]);
      }
      return { ok: true, data };
    } catch (err) {
      const message =
        err instanceof Error && err.name === "AbortError"
          ? "Gemini API request timed out."
          : "Gemini API request failed (network error).";
      // Never include the API key or raw response text in errors.
      return { ok: false, code: "AI_GENERATION_FAILED", message };
    } finally {
      clearTimeout(timeout);
    }
  },
};
