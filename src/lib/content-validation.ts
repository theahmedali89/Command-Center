import type { PlatformId } from "@/types";
import type { PlatformGenerated } from "@/providers/ai/types";

export interface ValidationIssue {
  field: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
  cleaned: Record<string, PlatformGenerated>;
}

/** Hard platform limits. Violations are repaired (truncated) and reported. */
const FIELD_LIMITS: Record<string, number> = {
  title: 120,
  hook: 280,
  caption: 2200,
  description: 5000,
};

const HASHTAG_PATTERN = /^#[A-Za-z0-9_]+$/;
const MAX_HASHTAGS = 30;
const KEYWORD_STUFFING_THRESHOLD = 6;

/** Common words excluded from keyword-stuffing detection to avoid false positives. */
const STOPWORDS = new Set([
  "the", "and", "a", "an", "to", "of", "in", "for", "on", "with",
  "is", "are", "was", "were", "be", "it", "its", "this", "that",
  "these", "those", "you", "your", "yours", "we", "our", "us",
  "as", "at", "by", "or", "from", "not", "but", "they", "their",
  "he", "she", "his", "her", "i", "my", "me", "so", "if", "do",
  "does", "did", "has", "have", "had", "will", "can", "all", "your",
]);

function cleanString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function cleanStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (trimmed.length === 0) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out.length > 0 ? out : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Deterministic validation + repair pipeline for AI-generated content.
 * NEVER trusts the raw AI output: every field is type-checked, trimmed,
 * length-checked and normalized before it is saved.
 *
 * - Missing platform (or a non-object entry) is fatal → valid: false.
 * - Length violations, invalid hashtags and empty strings are repaired in
 *   `cleaned` and reported as issues.
 * - Keyword stuffing is flagged, never fatal.
 */
export function validateGenerated(input: {
  data: Record<string, PlatformGenerated>;
  platforms: PlatformId[];
}): ValidationResult {
  const issues: ValidationIssue[] = [];
  const cleaned: Record<string, PlatformGenerated> = {};
  let valid = true;

  for (const platform of input.platforms) {
    const raw = input.data[platform];
    if (!isRecord(raw)) {
      valid = false;
      issues.push({
        field: platform,
        message: `Missing generated content for platform "${platform}".`,
      });
      continue;
    }

    const entry: PlatformGenerated = {};

    // Scalar text fields: trim, drop empties, enforce length limits.
    for (const field of ["title", "hook", "caption", "description", "cta", "videoIdea"] as const) {
      const value = cleanString(raw[field]);
      if (value === undefined) continue;
      const limit = FIELD_LIMITS[field];
      if (limit !== undefined && value.length > limit) {
        issues.push({
          field: `${platform}.${field}`,
          message: `${field} is ${value.length} characters (limit ${limit}); truncated.`,
        });
        entry[field] = value.slice(0, limit).trim();
      } else {
        entry[field] = value;
      }
    }

    // Hashtags: keep only valid ones, dedupe (case-insensitive), cap count.
    const rawHashtags = Array.isArray(raw.hashtags) ? raw.hashtags : [];
    const seenTags = new Set<string>();
    const hashtags: string[] = [];
    let strippedInvalid = 0;
    for (const tag of rawHashtags) {
      if (typeof tag !== "string") {
        strippedInvalid++;
        continue;
      }
      const trimmed = tag.trim();
      if (!HASHTAG_PATTERN.test(trimmed)) {
        strippedInvalid++;
        continue;
      }
      const key = trimmed.toLowerCase();
      if (seenTags.has(key)) continue;
      seenTags.add(key);
      hashtags.push(trimmed);
    }
    if (strippedInvalid > 0) {
      issues.push({
        field: `${platform}.hashtags`,
        message: `${strippedInvalid} invalid hashtag(s) removed (must match ${HASHTAG_PATTERN.source}).`,
      });
    }
    if (hashtags.length > MAX_HASHTAGS) {
      issues.push({
        field: `${platform}.hashtags`,
        message: `${hashtags.length} hashtags provided (limit ${MAX_HASHTAGS}); extras removed.`,
      });
    }
    if (hashtags.length > 0) {
      entry.hashtags = hashtags.slice(0, MAX_HASHTAGS);
    }

    // tags / keywords: trim, drop empties, dedupe.
    const tags = cleanStringArray(raw.tags);
    if (tags) entry.tags = tags;
    const keywords = cleanStringArray(raw.keywords);
    if (keywords) entry.keywords = keywords;

    // Quality rule (flag, never fail): keyword stuffing in caption.
    const caption = entry.caption;
    if (caption) {
      const counts = new Map<string, number>();
      for (const match of caption.toLowerCase().matchAll(/[\p{L}\p{N}]+/gu)) {
        const word = match[0];
        if (word.length < 3 || STOPWORDS.has(word)) continue;
        counts.set(word, (counts.get(word) ?? 0) + 1);
      }
      for (const [word, count] of counts) {
        if (count > KEYWORD_STUFFING_THRESHOLD) {
          issues.push({
            field: `${platform}.caption`,
            message: `Possible keyword stuffing: "${word}" appears ${count} times. Review before publishing.`,
          });
          break;
        }
      }
    }

    cleaned[platform] = entry;
  }

  return { valid, issues, cleaned };
}
