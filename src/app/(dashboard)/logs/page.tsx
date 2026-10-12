import Link from "next/link";
import { requireUser } from "@/lib/session";
import { db } from "@/lib/db";
import { AuditActions } from "@/lib/audit";
import { ACTOR_LABELS } from "@/types";
import { Card, Badge, EmptyState } from "@/components";

const LOG_LIMIT = 100;
const ACTIONS = Object.values(AuditActions);

interface PageSearchParams {
  [key: string]: string | string[] | undefined;
}

export default async function LogsPage({
  searchParams,
}: {
  searchParams: Promise<PageSearchParams>;
}): Promise<React.ReactElement> {
  const user = await requireUser();
  const sp = await searchParams;
  const rawAction = typeof sp.action === "string" ? sp.action : "";
  const actionFilter = (ACTIONS as string[]).includes(rawAction) ? rawAction : "";

  const logs = await db.auditLog.findMany({
    where: {
      userId: user.id,
      ...(actionFilter ? { action: actionFilter } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: LOG_LIMIT,
  });

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="text-2xl font-bold">Activity log</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Real events only — every entry records who (or what) did it. Showing
        the latest {LOG_LIMIT}.
      </p>

      <div className="mt-6 flex flex-wrap gap-2">
        <Link
          href="/logs"
          className={`rounded-full border px-3 py-1.5 text-sm ${
            !actionFilter
              ? "border-blue-600 bg-blue-600 text-white"
              : "border-zinc-300 text-zinc-600 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-300"
          }`}
        >
          All
        </Link>
        {ACTIONS.map((action) => (
          <Link
            key={action}
            href={`/logs?action=${action}`}
            className={`rounded-full border px-3 py-1.5 text-sm ${
              actionFilter === action
                ? "border-blue-600 bg-blue-600 text-white"
                : "border-zinc-300 text-zinc-600 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-300"
            }`}
          >
            {action}
          </Link>
        ))}
      </div>

      <Card className="mt-6">
        {logs.length === 0 ? (
          <EmptyState
            title="No activity yet"
            description={
              actionFilter
                ? "No events of this type have been recorded."
                : "Actions you take in the dashboard will appear here."
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-3xl text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-xs text-zinc-500 dark:border-zinc-800">
                  <th className="px-4 py-3 font-medium">Time</th>
                  <th className="px-4 py-3 font-medium">Actor</th>
                  <th className="px-4 py-3 font-medium">Action</th>
                  <th className="px-4 py-3 font-medium">Entity</th>
                  <th className="px-4 py-3 font-medium">Platform</th>
                  <th className="px-4 py-3 font-medium">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
                {logs.map((log) => (
                  <tr key={log.id} className="align-top">
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-zinc-500">
                      {log.createdAt.toISOString().replace("T", " ").slice(0, 19)}Z
                    </td>
                    <td className="px-4 py-3">
                      <Badge>{ACTOR_LABELS[log.actorType] ?? log.actorType}</Badge>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs">
                      {log.action}
                    </td>
                    <td className="px-4 py-3 text-xs text-zinc-500">
                      {log.entityType ? (
                        <>
                          {log.entityType}
                          {log.entityId && (
                            <span className="font-mono"> · {log.entityId.slice(0, 8)}…</span>
                          )}
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs capitalize">
                      {log.platform ?? "—"}
                    </td>
                    <td className="max-w-56 px-4 py-3">
                      {log.safeMetadata ? (
                        <details>
                          <summary className="cursor-pointer text-xs text-zinc-500">
                            View
                          </summary>
                          <pre className="mt-1 max-h-40 overflow-auto rounded bg-zinc-100 p-2 text-[11px] dark:bg-zinc-900">
                            {JSON.stringify(log.safeMetadata, null, 2)}
                          </pre>
                        </details>
                      ) : (
                        <span className="text-xs text-zinc-400">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
