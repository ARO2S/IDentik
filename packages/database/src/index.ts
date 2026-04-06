import { config as loadEnv } from 'dotenv';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import type { NeonHttpDatabase } from 'drizzle-orm/neon-http';
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

export type IdentikDatabase = NeonHttpDatabase<typeof schema>;

declare global {
  // eslint-disable-next-line no-var
  var __identikDb__: IdentikDatabase | undefined;
}

const globalRef = globalThis as typeof globalThis & {
  __identikDb__?: IdentikDatabase;
};

export const getDb = (): IdentikDatabase => {
  if (!globalRef.__identikDb__) {
    globalRef.__identikDb__ = drizzle(neon(getDatabaseUrl()), { schema });
  }
  return globalRef.__identikDb__;
};

// No-op: HTTP driver has no persistent pool to close.
export const closeDbPool = async (): Promise<void> => {};

export const withDb = async <T>(handler: (db: IdentikDatabase) => Promise<T>): Promise<T> => {
  return handler(getDb());
};

export const createDbClient = getDb;

export { schema };
