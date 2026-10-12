"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ToastProvider } from "@/components/Toast";

const LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/create", label: "Create" },
  { href: "/content", label: "Content" },
  { href: "/calendar", label: "Calendar" },
  { href: "/sites", label: "Sites" },
  { href: "/accounts", label: "Accounts" },
  { href: "/media", label: "Media" },
  { href: "/logs", label: "Logs" },
  { href: "/settings", label: "Settings" },
];

interface Props {
  user: { id: string; email: string; name: string | null | undefined };
  children: React.ReactNode;
}

export function DashboardShell({ user, children }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  async function logout() {
    setLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.push("/login");
      router.refresh();
    }
  }

  const nav = (
    <nav className="flex flex-col gap-1 p-3">
      {LINKS.map((l) => {
        const active = pathname === l.href || pathname.startsWith(l.href + "/");
        return (
          <Link
            key={l.href}
            href={l.href}
            onClick={() => setDrawerOpen(false)}
            className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              active
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
            }`}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <ToastProvider>
      <div className="flex min-h-screen bg-zinc-50 dark:bg-zinc-950">
        {/* Desktop sidebar */}
        <aside className="sticky top-0 hidden h-screen w-56 shrink-0 border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 lg:block">
          <div className="border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
            <p className="font-semibold">Command Center</p>
          </div>
          {nav}
        </aside>

        {/* Mobile drawer */}
        {drawerOpen && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <div
              className="absolute inset-0 bg-black/50"
              onClick={() => setDrawerOpen(false)}
              aria-hidden
            />
            <aside className="absolute left-0 top-0 h-full w-64 bg-white shadow-xl dark:bg-zinc-900">
              <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
                <p className="font-semibold">Command Center</p>
                <button
                  type="button"
                  onClick={() => setDrawerOpen(false)}
                  aria-label="Close menu"
                  className="rounded-lg p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
                >
                  ✕
                </button>
              </div>
              {nav}
            </aside>
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          {/* Topbar */}
          <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-zinc-200 bg-white/90 px-4 py-2.5 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/90">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open menu"
              className="rounded-lg p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 lg:hidden cursor-pointer"
            >
              ☰
            </button>
            <div className="ml-auto flex items-center gap-2">
              <ThemeToggle />
              <span
                className="hidden max-w-48 truncate text-sm text-zinc-600 dark:text-zinc-300 sm:inline"
                title={user.email}
              >
                {user.email}
              </span>
              <button
                type="button"
                onClick={logout}
                disabled={loggingOut}
                className="rounded-lg px-3 py-1.5 text-sm font-medium text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 dark:text-zinc-300 dark:hover:bg-zinc-800 cursor-pointer"
              >
                {loggingOut ? "Logging out…" : "Logout"}
              </button>
            </div>
          </header>

          <main className="flex-1 p-4 sm:p-6">{children}</main>
        </div>
      </div>
    </ToastProvider>
  );
}
