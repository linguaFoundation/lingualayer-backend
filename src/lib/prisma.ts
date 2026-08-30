import { PrismaClient } from "@prisma/client";

/**
 * One PrismaClient for the process.
 *
 * Each instance owns a connection pool, so constructing one per module — or
 * per request — exhausts Postgres' connection limit under load rather than
 * failing obviously in development.
 */
let client: PrismaClient | undefined;

export function getPrisma(): PrismaClient {
  if (!client) {
    client = new PrismaClient();
  }
  return client;
}

/** Closes the pool. Used by tests and by graceful shutdown. */
export async function disconnectPrisma(): Promise<void> {
  if (client) {
    await client.$disconnect();
    client = undefined;
  }
}

/**
 * Whether the database is reachable.
 *
 * Tests use this to skip rather than fail when no Postgres is configured
 * locally; CI always has one, and its migrate and seed steps would fail
 * before the tests if it did not.
 */
export async function isDatabaseAvailable(): Promise<boolean> {
  try {
    await getPrisma().$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}
