import { requireUser } from "@/lib/session";
import { db } from "@/lib/db";
import { CampaignStatus } from "@/types";
import ContentList, { type ContentCampaignView } from "./ContentList";

export const CONTENT_TABS = ["all", "draft", "scheduled", "published", "failed"] as const;
export type ContentTab = (typeof CONTENT_TABS)[number];

const TAB_TO_STATUS: Record<Exclude<ContentTab, "all">, CampaignStatus> = {
  draft: CampaignStatus.DRAFT,
  scheduled: CampaignStatus.SCHEDULED,
  published: CampaignStatus.PUBLISHED,
  failed: CampaignStatus.FAILED,
};

interface PageSearchParams {
  [key: string]: string | string[] | undefined;
}

export default async function ContentPage({
  searchParams,
}: {
  searchParams: Promise<PageSearchParams>;
}): Promise<React.ReactElement> {
  const user = await requireUser();
  const sp = await searchParams;
  const rawTab = typeof sp.status === "string" ? sp.status : "all";
  const tab: ContentTab = (CONTENT_TABS as readonly string[]).includes(rawTab)
    ? (rawTab as ContentTab)
    : "all";

  const campaigns = await db.contentCampaign.findMany({
    where: {
      userId: user.id,
      ...(tab !== "all" ? { status: TAB_TO_STATUS[tab] } : {}),
    },
    orderBy: { createdAt: "desc" },
    include: {
      platformContents: { orderBy: { platform: "asc" } },
    },
  });

  // Serialize Date objects for the client component boundary.
  const view: ContentCampaignView[] = campaigns.map((c) => ({
    id: c.id,
    topic: c.topic,
    context: c.context,
    goal: c.goal,
    language: c.language,
    tone: c.tone,
    destinationUrl: c.destinationUrl,
    status: c.status,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    platformContents: c.platformContents.map((p) => ({
      id: p.id,
      platform: p.platform,
      title: p.title,
      hook: p.hook,
      caption: p.caption,
      description: p.description,
      cta: p.cta,
      hashtags: p.hashtags,
      status: p.status,
      version: p.version,
      createdAt: p.createdAt.toISOString(),
    })),
  }));

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="text-2xl font-bold">Content</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Campaigns with per-platform versions. Select a platform row to inspect
        its current content and version.
      </p>
      <ContentList initialCampaigns={view} activeTab={tab} />
    </div>
  );
}
