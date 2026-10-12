import { geminiProvider } from "./gemini";
import type { AIProvider } from "./types";

export type { AIProvider, GenerateInput, GenerateResult, PlatformGenerated } from "./types";
export { geminiProvider } from "./gemini";

/**
 * Returns the active AI provider.
 * Abstraction point: when a second provider (e.g. a local model) is added,
 * select it here based on user settings or environment — callers keep using
 * the AIProvider interface unchanged.
 */
export function getAIProvider(): AIProvider {
  return geminiProvider;
}
