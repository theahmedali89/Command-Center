"use client";

/**
 * Client-side content browser: status tabs, search box, campaign cards with
 * expandable platform rows. Data is fetched server-side by page.tsx.
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import { Card, Input, Badge, Tabs, StatusBadge, EmptyState } from "@/components";
import type { CampaignStatus, PublishStatus } from "@/types";
import type { ContentTab } from "./page";

export interface PlatformContentView {
  id: string;
  platform: string;
  title: string | null;
  hook: string | null;
  caption: string | null;
  description: string | null;
  cta: string | null;
  hashtags: string[];
  status: PublishStatus;
  version: number;
  createdAt: string;
}

export interface ContentCampaignView {
  id: string;
  topic: string;
  context: string | null;
  goal: string | null;
  language: string;
  tone: string;
  destinationUrl: string | null;
  status: CampaignStatus;
  createdAt: string;
  updatedAt: string;
  platformContents: PlatformContentView[];
}

const TABS: { label: string; value: ContentTab }[] = [
  { label: "All", value: "all" },
  { label: "Draft", value: "draft" },
  { label: "Scheduled", value: "scheduled" },
  { label: "Published", value: "published" },
  { label: "Failed", value: "failed" },
];

function excerpt(text: string | null, max = 140): string {
  if (!text) return "—";
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export default function ContentList({
  initialCampaigns,
  activeTab,
}: {
  initialCampaigns: ContentCampaignView[];
  activeTab: ContentTab;
}): React.ReactElement {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return initialCampaigns;
    return initialCampaigns.filter(
      (c) =>
        c.topic.toLowerCase().includes(q) ||
        c.platformContents.some(
          (p) =>
            p.platform.toLowerCase().includes(q) ||
            (p.title ?? "").toLowerCase().includes(q),
        ),
    );
  }, [initialCampaigns, query]);

  return (
    <div className="mt-6 space-y-6">
      <Tabs
        tabs={TABS}
        value={activeTab}
        onChange={(key: string) => {
          const value = key as ContentTab;
          window.location.href = value === "all" ? "/content" : `/content?status=${value}`;
        }}
      />

      <Input
        value={query}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
        placeholder="Search campaigns by topic, platform or title…"
      />

      {filtered.length === 0 ? (
        <EmptyState
          title="No campaigns found"
          description={
            query
              ? "Nothing matches your search. Try a different keyword."
              : "Create your first campaign from the Create page."
          }
        />
      ) : (
        <div className="space-y-4">
          {filtered.map((campaign) => {
            const isOpen = expanded === campaign.id;
            return (
              <Card key={campaign.id} className="overflow-hidden">
                <button
                  type="button"
                  onClick={() => setExpanded(isOpen ? null : campaign.id)}
                  className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
                  aria-expanded={isOpen}
                >
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{campaign.topic}</p>
                    <p className="mt-1 text-xs text-zinc-500">
                      {campaign.platformContents.length} platform
                      {campaign.platformContents.length === 1 ? "" : "s"}
                      {campaign.goal ? ` · ${campaign.goal}` : ""} ·{" "}
                      {new Date(campaign.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <StatusBadge status={campaign.status} />
                </button>

                {isOpen && (
                  <div className="border-t border-zinc-200 px-5 py-4 dark:border-zinc-800">
                    <dl className="grid gap-3 text-sm sm:grid-cols-2">
                      <div>
                        <dt className="text-xs font-medium text-zinc-500">Tone</dt>
                        <dd>{campaign.tone}</dd>
                      </div>
                      <div>
                        <dt className="text-xs font-medium text-zinc-500">Language</dt>
                        <dd>{campaign.language}</dd>
                      </div>
                      {campaign.destinationUrl && (
                        <div className="sm:col-span-2">
                          <dt className="text-xs font-medium text-zinc-500">
                            Destination URL
                          </dt>
                          <dd className="break-all">
                            <Link
                              href={campaign.destinationUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-600 hover:underline dark:text-blue-400"
                            >
                              {campaign.destinationUrl}
                            </Link>
                          </dd>
                        </div>
                      )}
                      {campaign.context && (
                        <div className="sm:col-span-2">
                          <dt className="text-xs font-medium text-zinc-500">Context</dt>
                          <dd className="whitespace-pre-wrap">{campaign.context}</dd>
                        </div>
                      )}
                    </dl>

                    <h3 className="mt-5 text-sm font-semibold">Platform versions</h3>
                    <ul className="mt-2 divide-y divide-zinc-200 dark:divide-zinc-800">
                      {campaign.platformContents.map((p) => (
                        <li key={p.id} className="py-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge>{p.platform}</Badge>
                            <StatusBadge status={p.status} />
                            <span className="text-xs text-zinc-500">v{p.version}</span>
                          </div>
                          {p.title && (
                            <p className="mt-2 text-sm font-medium">{p.title}</p>
                          )}
                          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                            {excerpt(p.hook ?? p.caption)}
                          </p>
                          {p.hashtags.length > 0 && (
                            <p className="mt-1 text-xs text-blue-600 dark:text-blue-400">
                              {p.hashtags.join(" ")}
                            </p>
                          )}
                          {(p.caption || p.description || p.cta) && (
                            <details className="mt-2 text-sm">
                              <summary className="cursor-pointer text-xs font-medium text-zinc-500">
                                Full content
                              </summary>
                              <div className="mt-2 space-y-2 whitespace-pre-wrap">
                                {p.caption && <p>{p.caption}</p>}
                                {p.description && <p>{p.description}</p>}
                                {p.cta && (
                                  <p>
                                    <span className="font-medium">CTA: </span>
                                    {p.cta}
                                  </p>
                                )}
                              </div>
                            </details>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
