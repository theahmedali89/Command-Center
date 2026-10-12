import Link from "next/link";
import { requireUser } from "@/lib/session";
import { db } from "@/lib/db";
import { Badge, EmptyState } from "@/components";

/** Dot colors per publish status — honest, one status per post. */
const STATUS_DOT: Record<string, string> = {
  SCHEDULED: "bg-blue-500",
  PROCESSING: "bg-amber-500",
  PUBLISHED: "bg-green-500",
  PARTIALLY_PUBLISHED: "bg-teal-500",
  FAILED: "bg-red-500",
  CANCELLED: "bg-zinc-400",
  READY: "bg-indigo-400",
  DRAFT: "bg-zinc-300",
};

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DAY_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

function monthLabel(year: number, month: number): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}

function shiftMonth(year: number, month: number, delta: number): string {
  const d = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function formatTimeInZone(date: Date, tz: string): string {
  const opts: Intl.DateTimeFormatOptions = {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: tz,
  };
  try {
    return new Intl.DateTimeFormat("en-GB", opts).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-GB", { ...opts, timeZone: "UTC" }).format(date);
  }
}

function dayKeyUtc(date: Date): string {
  return date.toISOString().slice(0, 10);
}

interface PageSearchParams {
  [key: string]: string | string[] | undefined;
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<PageSearchParams>;
}): Promise<React.ReactElement> {
  const user = await requireUser();
  const sp = await searchParams;

  const now = new Date();
  const rawMonth = typeof sp.month === "string" ? sp.month : "";
  const monthParam = MONTH_RE.test(rawMonth)
    ? rawMonth
    : `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const [yearStr, monthStr] = monthParam.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);

  const rawDay = typeof sp.day === "string" ? sp.day : "";
  const selectedDay = DAY_RE.test(rawDay) ? rawDay : null;

  const rangeStart = new Date(Date.UTC(year, month - 1, 1));
  const rangeEnd = new Date(Date.UTC(year, month, 1));

  const posts = await db.scheduledPost.findMany({
    where: {
      platformContent: { campaign: { userId: user.id } },
      scheduledAtUtc: { gte: rangeStart, lt: rangeEnd },
    },
    orderBy: { scheduledAtUtc: "asc" },
    include: {
      platformContent: {
        include: {
          campaign: { select: { id: true, topic: true } },
        },
      },
      socialAccount: {
        select: { id: true, platform: true, accountName: true },
      },
    },
  });

  const byDay = new Map<string, typeof posts>();
  for (const post of posts) {
    const key = dayKeyUtc(post.scheduledAtUtc);
    const list = byDay.get(key) ?? [];
    list.push(post);
    byDay.set(key, list);
  }

  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const leadingBlanks = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const cells: (number | null)[] = [
    ...Array<null>(leadingBlanks).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const prev = shiftMonth(year, month, -1);
  const next = shiftMonth(year, month, 1);
  const dayPosts = selectedDay ? (byDay.get(selectedDay) ?? []) : [];

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Calendar</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Scheduled posts by day. Times shown in each post&apos;s display
            timezone; stored in UTC.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/calendar?month=${prev}`}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            ← Prev
          </Link>
          <span className="min-w-36 text-center text-sm font-medium">
            {monthLabel(year, month)}
          </span>
          <Link
            href={`/calendar?month=${next}`}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Next →
          </Link>
        </div>
      </div>

      <div className="mt-6 overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
        <div className="grid grid-cols-7 bg-zinc-50 text-center text-xs font-medium text-zinc-500 dark:bg-zinc-900">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
            <div key={d} className="px-1 py-2">
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((day, i) => {
            if (day === null) {
              return (
                <div
                  key={`blank-${i}`}
                  className="min-h-20 border-t border-zinc-100 dark:border-zinc-900"
                />
              );
            }
            const key = `${monthParam}-${String(day).padStart(2, "0")}`;
            const dayList = byDay.get(key) ?? [];
            const isSelected = selectedDay === key;
            const isToday = dayKeyUtc(now) === key;
            return (
              <Link
                key={key}
                href={`/calendar?month=${monthParam}&day=${key}`}
                className={`flex min-h-20 flex-col gap-1 border-t border-zinc-100 p-1.5 text-left transition-colors dark:border-zinc-900 ${
                  isSelected
                    ? "bg-blue-50 dark:bg-blue-950"
                    : "hover:bg-zinc-50 dark:hover:bg-zinc-900"
                }`}
              >
                <span
                  className={`text-xs font-medium ${
                    isToday
                      ? "flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 text-white"
                      : "text-zinc-700 dark:text-zinc-300"
                  }`}
                >
                  {day}
                </span>
                <span className="flex flex-wrap gap-1">
                  {dayList.slice(0, 6).map((p) => (
                    <span
                      key={p.id}
                      title={`${p.platformContent.platform} — ${p.status}`}
                      className={`h-2 w-2 rounded-full ${STATUS_DOT[p.status] ?? "bg-zinc-300"}`}
                    />
                  ))}
                  {dayList.length > 6 && (
                    <span className="text-[10px] text-zinc-500">+{dayList.length - 6}</span>
                  )}
                </span>
              </Link>
            );
          })}
        </div>
      </div>

      {selectedDay && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold">
            {new Intl.DateTimeFormat("en-US", {
              weekday: "long",
              year: "numeric",
              month: "long",
              day: "numeric",
              timeZone: "UTC",
            }).format(new Date(`${selectedDay}T00:00:00Z`))}
          </h2>
          {dayPosts.length === 0 ? (
            <EmptyState
              title="Nothing scheduled"
              description="No posts are scheduled for this day."
            />
          ) : (
            <ul className="mt-4 space-y-3">
              {dayPosts.map((p) => (
                <li
                  key={p.id}
                  className="flex flex-wrap items-center gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
                >
                  <span
                    className={`h-2.5 w-2.5 rounded-full ${STATUS_DOT[p.status] ?? "bg-zinc-300"}`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {p.platformContent.campaign.topic}
                    </p>
                    <p className="mt-0.5 text-xs text-zinc-500">
                      {formatTimeInZone(p.scheduledAtUtc, p.displayTimezone)} (
                      {p.displayTimezone}) ·{" "}
                      {p.socialAccount
                        ? `${p.socialAccount.platform}${p.socialAccount.accountName ? ` — ${p.socialAccount.accountName}` : ""}`
                        : "website"}
                    </p>
                    {p.lastSafeErrorMessage && (
                      <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                        {p.lastSafeErrorMessage}
                      </p>
                    )}
                  </div>
                  <Badge>{p.platformContent.platform}</Badge>
                  <Badge>{p.status}</Badge>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
