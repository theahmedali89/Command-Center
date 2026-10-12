import { connection } from "next/server";
import { requireUser } from "@/lib/session";
import { DashboardShell } from "./_components/DashboardShell";

// Dashboard pages read the session cookie: opt out of static-shell validation.
export const instant = false;

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Session cookies are request-time data: never prerender dashboard pages.
  await connection();
  const user = await requireUser();
  return <DashboardShell user={user}>{children}</DashboardShell>;
}
