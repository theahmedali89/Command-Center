import { defineConfig } from "prisma/config";

/** Same resolution as src/lib/db-url.ts (kept inline: config loader context). */
function resolveDatabaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const names = Object.keys(process.env);
  const key = names.find(
    (k) =>
      (k.endsWith("_DATABASE_URL") || k.endsWith("_POSTGRES_URL")) &&
      process.env[k],
  );
  if (key) return process.env[key] as string;
  throw new Error("No Postgres URL found for Prisma config.");
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: resolveDatabaseUrl(),
  },
});
