import { createHash } from "node:crypto";

export interface IdempotencyKeyParams {
  campaignId: string;
  platformContentId: string;
  accountId: string;
  contentVersion: number;
}

/**
 * Deterministic idempotency key for a publish attempt.
 *
 * Combines the campaign, platform content, target account (social account
 * or website id), and the locked content version. The same logical publish
 * always produces the same key, so retries and scheduler re-runs can check
 * prior state instead of posting a duplicate.
 */
export function buildIdempotencyKey(p: IdempotencyKeyParams): string {
  const raw = `${p.campaignId}|${p.platformContentId}|${p.accountId}|${p.contentVersion}`;
  const digest = createHash("sha256").update(raw, "utf8").digest("hex");
  return `cc_${digest.slice(0, 40)}`;
}
