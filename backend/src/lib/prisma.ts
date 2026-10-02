import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const connectionString = process.env.DATABASE_URL;
const enablePrismaQueryLogs = /^(1|true|yes|on)$/i.test(String(process.env.PRISMA_QUERY_LOGS || ''));

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  pgPool: Pool | undefined;
  shutdownHookInstalled: boolean | undefined;
};

const pool =
  globalForPrisma.pgPool ??
  new Pool({
    connectionString,
    max: Number(process.env.DB_POOL_MAX || 20),
    idleTimeoutMillis: Number(process.env.DB_POOL_IDLE_TIMEOUT_MS || 30_000),
    connectionTimeoutMillis: Number(process.env.DB_POOL_CONNECTION_TIMEOUT_MS || 10_000),
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.pgPool = pool;
}

const adapter = new PrismaPg(pool as unknown as ConstructorParameters<typeof PrismaPg>[0]);

// Singleton pattern para evitar múltiplas instâncias do PrismaClient
// especialmente importante em desenvolvimento com hot-reload
export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
    log:
      process.env.NODE_ENV === 'development'
        ? enablePrismaQueryLogs
          ? ['query', 'error', 'warn']
          : ['error', 'warn']
        : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

if (!globalForPrisma.shutdownHookInstalled) {
  const shutdown = async () => {
    await prisma.$disconnect();
    await pool.end();
  };

  process.once('beforeExit', shutdown);
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  globalForPrisma.shutdownHookInstalled = true;
}

export default prisma;
