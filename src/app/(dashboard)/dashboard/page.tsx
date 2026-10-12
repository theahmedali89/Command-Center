import { requireUser } from "@/lib/session";
import { db } from "@/lib/db";
import { ACTOR_LABELS, type ConnectionStatus } from "@/types";
import { Card } from "@/components/Card";
import { StatusBadge } from "@/components/StatusBadge";
import { EmptyState } from "@/components/EmptyState";

function StatCard({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <p className="text-sm text-zinc-500 dark:text-zinc-400">{label}</p>
      <p className="mt-1 text-3xl font-bold tabular-nums">{value}</p>
      {hint && <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{hint}</p>}
    </div>
  );
}

function formatDate(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleString();
}

export default async function DashboardPage() {
  const user = await requireUser();
  const userId = user.id;

  const [websiteGroups, socialAccounts, campaignGroups, upcomingCount, publishedCount, failedCount, websites, recentLogs] =
    await Promise.all([
      db.website.groupBy({ by: ["status"], where: { userId }, _count: true }),
      db.socialAccount.findMany({
        where: { userId },
        select: {
          platform: true,
          accountName: true,
          connectionStatus: true,
          lastVerifiedAt: true,
          lastError: true,
        },
      }),
      db.contentCampaign.groupBy({ by: ["status"], where: { userId }, _count: true }),
      db.scheduledPost.count({
        where: {
          platformContent: { campaign: { userId } },
          status: "SCHEDULED",
          scheduledAtUtc: { gte: new Date() },
        },
      }),
      db.scheduledPost.count({
        where: { platformContent: { campaign: { userId } }, status: "PUBLISHED" },
      }),
      db.scheduledPost.count({
        where: { platformContent: { campaign: { userId } }, status: "FAILED" },
      }),
      db.website.findMany({
        where: { userId },
        select: { name: true, url: true, status: true, lastVerifiedAt: true, lastError: true },
        orderBy: { createdAt: "asc" },
      }),
      db.auditLog.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: 10,
      }),
    ]);

  const connectedSocial = socialAccounts.filter(
    (a) => a.connectionStatus === ("CONNECTED" as ConnectionStatus)
  ).length;

  const totalWebsites = websiteGroups.reduce((n, g) => n + g._count, 0);
  const totalCampaigns = campaignGroups.reduce((n, g) => n + g._count, 0);

  const healthItems = [
    ...websites.map((w) => ({
      key: `site-${w.name}-${w.url}`,
      name: w.name,
      detail: w.url,
      status: w.status as ConnectionStatus,
      lastVerifiedAt: w.lastVerifiedAt,
      lastError: w.lastError,
    })),
    ...socialAccounts.map((a) => ({
      key: `account-${a.platform}`,
      name: a.accountName ?? a.platform,
      detail: a.platform,
      status: a.connectionStatus as ConnectionStatus,
      lastVerifiedAt: a.lastVerifiedAt,
      lastError: a.lastError,
    })),
  ];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Live overview of your sites, accounts, and publishing activity.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Websites" value={totalWebsites} hint="connected via WordPress API" />
        <StatCard
          label="Social accounts"
          value={`${connectedSocial}/${socialAccounts.length}`}
          hint="connected / tracked"
        />
        <StatCard label="Campaigns" value={totalCampaigns} hint="content campaigns" />
        <StatCard label="Upcoming posts" value={upcomingCount} hint="scheduled and pending" />
        <StatCard label="Published" value={publishedCount} hint="successful publishes" />
        <StatCard label="Failed" value={failedCount} hint="posts needing attention" />
      </div>

      <Card title="Account health" subtitle="Current connection state of every website and social account.">
        {healthItems.length === 0 ? (
          <EmptyState
            title="Nothing connected yet"
            hint="Add a WordPress site on the Sites page or connect a social account on the Accounts page to start."
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {healthItems.map((item) => (
              <li
                key={item.key}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-200 px-4 py-3 dark:border-zinc-800"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{item.name}</p>
                  <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">{item.detail}</p>
                  {item.lastError && (
                    <p className="mt-1 text-xs text-red-600 dark:text-red-400">{item.lastError}</p>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1">
                  <StatusBadge status={item.status} />
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    Verified: {formatDate(item.lastVerifiedAt)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Recent activity" subtitle="The 10 latest actions, labeled by actor.">
        {recentLogs.length === 0 ? (
          <EmptyState
            title="No activity yet"
            hint="Actions like connecting an account or publishing a post will appear here."
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {recentLogs.map((log) => (
              <li
                key={log.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-200 px-4 py-2.5 text-sm dark:border-zinc-800"
              >
                <div className="min-w-0">
                  <span className="font-medium">{ACTOR_LABELS[log.actorType] ?? log.actorType}</span>
                  <span className="text-zinc-500 dark:text-zinc-400"> · {log.action}</span>
                  {log.platform && (
                    <span className="text-zinc-500 dark:text-zinc-400"> · {log.platform}</span>
                  )}
                </div>
                <time className="text-xs text-zinc-500 dark:text-zinc-400">
                  {formatDate(log.createdAt)}
                </time>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
