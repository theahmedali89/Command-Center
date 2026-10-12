import type { ActorType, Prisma } from "@prisma/client";
import { db } from "./db";

export interface AuditEvent {
  userId: string;
  actorType: ActorType;
  actorId?: string;
  action: string;
  entityType?: string;
  entityId?: string;
  platform?: string;
  safeMetadata?: Prisma.InputJsonValue;
}

/**
 * Write an audit log entry. Never pass secrets in safeMetadata.
 * Failures are swallowed (logged to console) so auditing never breaks
 * the primary operation.
 */
export async function audit(event: AuditEvent): Promise<void> {
  try {
    await db.auditLog.create({ data: event });
  } catch (err) {
    console.error("[audit] failed to write audit log:", (err as Error).message);
  }
}

export const AuditActions = {
  ACCOUNT_CONNECTED: "ACCOUNT_CONNECTED",
  ACCOUNT_DISCONNECTED: "ACCOUNT_DISCONNECTED",
  ACCOUNT_UPDATED: "ACCOUNT_UPDATED",
  WEBSITE_CONNECTED: "WEBSITE_CONNECTED",
  WEBSITE_DISCONNECTED: "WEBSITE_DISCONNECTED",
  CONTENT_GENERATED: "CONTENT_GENERATED",
  CONTENT_EDITED: "CONTENT_EDITED",
  MEDIA_UPLOADED: "MEDIA_UPLOADED",
  POST_SCHEDULED: "POST_SCHEDULED",
  POST_PUBLISH_STARTED: "POST_PUBLISH_STARTED",
  POST_PUBLISHED: "POST_PUBLISHED",
  POST_FAILED: "POST_FAILED",
  POST_RETRIED: "POST_RETRIED",
  TOKEN_REFRESHED: "TOKEN_REFRESHED",
  AGENT_KEY_CREATED: "AGENT_KEY_CREATED",
  AGENT_KEY_REVOKED: "AGENT_KEY_REVOKED",
} as const;
