import { NextRequest } from "next/server";
import { requireApiUser } from "@/lib/session";
import { ok, unexpectedError, authFailureResponse } from "@/lib/api";

/**
 * Integration presence checks — booleans only, never secret values.
 *
 * Convention (documented for the coordinator): a check is "configured" when
 * ANY one of its envGroups is fully present. Bluesky and WordPress have no
 * OAuth app env — they connect per-account (Bluesky app password, WP
 * Application Password) via the Sites/Accounts screens, so they intentionally
 * report configured=false here with a note.
 */
const ENV_CHECKS: {
  id: string;
  label: string;
  envGroups: string[][];
  note?: string;
}[] = [
  { id: "gemini", label: "Gemini AI (content generation)", envGroups: [["GEMINI_API_KEY"]] },
  {
    id: "r2",
    label: "Cloudflare R2 (media storage)",
    envGroups: [["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"]],
  },
  {
    id: "facebook",
    label: "Facebook",
    envGroups: [
      ["FACEBOOK_APP_ID", "FACEBOOK_CLIENT_SECRET"],
      ["FACEBOOK_CLIENT_ID", "FACEBOOK_CLIENT_SECRET"],
    ],
  },
  {
    id: "instagram",
    label: "Instagram",
    envGroups: [["INSTAGRAM_CLIENT_ID", "INSTAGRAM_CLIENT_SECRET"]],
  },
  {
    id: "youtube",
    label: "YouTube",
    envGroups: [
      ["YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET"],
      ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
    ],
  },
  {
    id: "tiktok",
    label: "TikTok",
    envGroups: [
      ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"],
      ["TIKTOK_CLIENT_ID", "TIKTOK_CLIENT_SECRET"],
    ],
  },
  {
    id: "pinterest",
    label: "Pinterest",
    envGroups: [["PINTEREST_CLIENT_ID", "PINTEREST_CLIENT_SECRET"]],
  },
  {
    id: "x",
    label: "X",
    envGroups: [
      ["X_CLIENT_ID", "X_CLIENT_SECRET"],
      ["TWITTER_CLIENT_ID", "TWITTER_CLIENT_SECRET"],
    ],
  },
  {
    id: "threads",
    label: "Threads",
    envGroups: [["THREADS_CLIENT_ID", "THREADS_CLIENT_SECRET"]],
  },
  { id: "telegram", label: "Telegram", envGroups: [["TELEGRAM_BOT_TOKEN"]] },
  {
    id: "tumblr",
    label: "Tumblr",
    envGroups: [["TUMBLR_CLIENT_ID", "TUMBLR_CLIENT_SECRET"], ["TUMBLR_API_KEY"]],
  },
  {
    id: "bluesky",
    label: "Bluesky",
    envGroups: [],
    note: "Connects per-account via app password — no OAuth app env needed.",
  },
  {
    id: "linkedin",
    label: "LinkedIn",
    envGroups: [["LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET"]],
  },
  {
    id: "wordpress",
    label: "WordPress",
    envGroups: [],
    note: "Connects per-website via Application Password on the Sites screen.",
  },
];

export interface IntegrationStatus {
  id: string;
  label: string;
  configured: boolean;
  note?: string;
}

/** Shared by the GET handler and the settings page — one source of truth. */
export function getIntegrationStatuses(): IntegrationStatus[] {
  return ENV_CHECKS.map((check) => ({
    id: check.id,
    label: check.label,
    configured:
      check.envGroups.length > 0 &&
      check.envGroups.some((group) => group.every((v) => !!process.env[v])),
    note: check.note,
  }));
}

export async function GET(_req: NextRequest): Promise<Response> {
  try {
    await requireApiUser();
    return ok({ integrations: getIntegrationStatuses() });
  } catch (err) {
    return authFailureResponse(err) ?? unexpectedError("reading integration statuses");
  }
}
