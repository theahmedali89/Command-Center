import { connection } from "next/server";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import { LoginForm } from "./LoginForm";

export const metadata = {
  title: "Sign in · Command Center",
};

// This page reads the session cookie: opt out of static-shell validation.
export const instant = false;

/**
 * Server gate: already-signed-in users never see the login form.
 */
export default async function LoginPage() {
  // Cookie check is request-time data: never prerender.
  await connection();
  const user = await getSessionUser();
  if (user) redirect("/dashboard");

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-100 px-4 dark:bg-zinc-950">
      <div className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
          Command Center
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Sign in to continue.
        </p>
        <LoginForm />
      </div>
    </main>
  );
}
