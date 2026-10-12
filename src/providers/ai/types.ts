import type { PlatformId } from "@/types";

export interface GenerateInput {
  topic: string;
  context?: string;
  goal?: string;
  language: string;
  tone: string;
  destinationUrl?: string;
  platforms: PlatformId[];
  brand?: {
    name?: string;
    websiteUrl?: string;
    description?: string;
  };
}

/** Normalized per-platform content produced by the AI provider. */
export interface PlatformGenerated {
  title?: string;
  hook?: string;
  caption?: string;
  description?: string;
  cta?: string;
  hashtags?: string[];
  tags?: string[];
  keywords?: string[];
  videoIdea?: string;
}

export type GenerateResult =
  | { ok: true; data: Record<string, PlatformGenerated> }
  | {
      ok: false;
      code: "AI_NOT_CONFIGURED" | "AI_GENERATION_FAILED";
      message: string;
    };

export interface AIProvider {
  id: string;
  generate(input: GenerateInput): Promise<GenerateResult>;
}
