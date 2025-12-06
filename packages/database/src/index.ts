import { config as loadEnv } from 'dotenv';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool, type PoolConfig } from 'pg';
import * as schema from './schema.js';
import { getDatabaseUrl } from './env.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, '..');
const workspacesRoot = path.resolve(packageRoot, '..');
const repoRoot = path.resolve(workspacesRoot, '..');
const envCandidates = [
  path.resolve(packageRoot, '.env'),
  path.resolve(repoRoot, '.env'),
  path.resolve(repoRoot, '.env.local'),
  path.resolve(repoRoot, 'web/.env'),
  path.resolve(repoRoot, 'web/.env.local')
];

for (const envPath of envCandidates) {
  if (existsSync(envPath)) {
    loadEnv({ path: envPath, override: false });
  }
}

export type IdentikDatabase = NodePgDatabase<typeof schema>;

declare global {
  // eslint-disable-next-line no-var
  var __identikDb__: IdentikDatabase | undefined;
  // eslint-disable-next-line no-var
  var __identikPool__: Pool | undefined;
}

const globalRef = globalThis as typeof globalThis & {
  __identikDb__?: IdentikDatabase;
  __identikPool__?: Pool;
};

const createPool = () => {
  const config: PoolConfig = {
    connectionString: getDatabaseUrl(),
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    idleTimeoutMillis: Number(process.env.DATABASE_POOL_IDLE_TIMEOUT_MS ?? 10_000)
  };

  return new Pool(config);
};

export const getDb = (): IdentikDatabase => {
  if (!globalRef.__identikPool__) {
    globalRef.__identikPool__ = createPool();
  }

  if (!globalRef.__identikDb__) {
    globalRef.__identikDb__ = drizzle(globalRef.__identikPool__, { schema });
  }

  return globalRef.__identikDb__;
};

export const closeDbPool = async (): Promise<void> => {
  if (globalRef.__identikPool__) {
    await globalRef.__identikPool__.end();
  }

  globalRef.__identikPool__ = undefined;
  globalRef.__identikDb__ = undefined;
};

export const withDb = async <T>(handler: (db: IdentikDatabase) => Promise<T>): Promise<T> => {
  const db = getDb();
  return handler(db);
};

export const createDbClient = getDb;

export { schema };
export * from './supabase.js';
