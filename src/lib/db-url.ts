/**
 * Resolve the Postgres connection URL.
 *
 * Priority:
 *  1. DATABASE_URL (local dev / standard)
 *  2. Any *_DATABASE_URL (Vercel storage integrations inject prefixed names,
 *     e.g. command_center_db_DATABASE_URL)
 *  3. Any *_POSTGRES_URL (fallback)
 *
 * Throws a clear error when nothing is found.
 */
export function resolveDatabaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const names = Object.keys(process.env);
  const dbUrlKey = names.find(
    (k) => k.endsWith("_DATABASE_URL") && process.env[k],
  );
  if (dbUrlKey) return process.env[dbUrlKey] as string;
  const pgUrlKey = names.find(
    (k) => k.endsWith("_POSTGRES_URL") && process.env[k],
  );
  if (pgUrlKey) return process.env[pgUrlKey] as string;
  throw new Error(
    "No Postgres URL found. Set DATABASE_URL or connect a Vercel Postgres integration.",
  );
}
