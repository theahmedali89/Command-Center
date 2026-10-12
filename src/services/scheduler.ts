import { db } from "@/lib/db";
import { PublishStatus } from "@/types";
import { executePublish } from "./publishing";

/** Swappable scheduler abstraction. Local runtime runs via runDuePosts(). */
export interface SchedulerProvider {
  schedule(input: { scheduledPostId: string }): Promise<void>;
  cancel(scheduledPostId: string): Promise<void>;
}

/**
 * Local runtime scheduler. schedule()/cancel() are intentional no-ops:
 * there is no persistent queue process in v1. Milo's runtime (crons) calls
 * runDuePosts() on its own tick, which picks up everything due from the DB.
 * Switching to a real queue later means implementing this interface without
 * touching callers.
 */
export const localRuntimeScheduler: SchedulerProvider = {
  async schedule(): Promise<void> {
    // No-op: posts are discovered by runDuePosts() via their scheduledAtUtc.
  },
  async cancel(): Promise<void> {
    // No-op: cancellation is a status change (CANCELLED) on the ScheduledPost.
  },
};

export interface RunDueResult {
  processed: number;
  published: number;
  failed: number;
}

/**
 * Publish everything due now: SCHEDULED posts whose time has come, plus
 * FAILED posts whose nextRetryAt is in the past (bounded retries, §7).
 * One post's failure never stops the batch.
 */
export async function runDuePosts(limit = 25): Promise<RunDueResult> {
  const now = new Date();

  const due = await db.scheduledPost.findMany({
    where: {
      OR: [
        { status: PublishStatus.SCHEDULED, scheduledAtUtc: { lte: now } },
        {
          status: PublishStatus.FAILED,
          scheduledAtUtc: { lte: now },
          nextRetryAt: { lte: now },
        },
      ],
    },
    orderBy: { scheduledAtUtc: "asc" },
    take: Math.max(1, Math.min(100, limit)),
    select: { id: true },
  });

  const result: RunDueResult = { processed: 0, published: 0, failed: 0 };

  for (const post of due) {
    try {
      const publishResult = await executePublish({
        scheduledPostId: post.id,
        actorType: "AUTOMATION",
        actorId: "milo-runtime",
      });
      result.processed += 1;
      if (publishResult.ok) {
        result.published += 1;
      } else {
        result.failed += 1;
      }
    } catch (err) {
      // executePublish is defensive, but never let a throw stop the batch.
      console.error(`[scheduler] post ${post.id} threw:`, (err as Error).message);
      result.processed += 1;
      result.failed += 1;
    }
  }

  return result;
}
