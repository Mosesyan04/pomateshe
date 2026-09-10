import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";

/**
 * The ONLY place APP_DATABASE_URL is read. This must always be the `pomateshe_app` role
 * connection string, never the migrator's — see docs/MULTI_TENANCY.md §2.3. Using the
 * migrator connection here would make the running app connect as the table owner, which
 * silently disables Row-Level Security regardless of how many policies exist.
 */
const connectionString = process.env.APP_DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "APP_DATABASE_URL is not set. This must be the pomateshe_app role connection string " +
      "(not DATABASE_URL, which is reserved for prisma migrate). See .env.example.",
  );
}

const adapter = new PrismaPg({ connectionString });

// Singleton across hot-reloads in dev (Next.js re-evaluates modules on every edit; without
// this a new PrismaClient/connection pool would be created on every reload).
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
