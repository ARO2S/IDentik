import { config as loadEnv } from 'dotenv';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'drizzle-kit';

const packageRoot = path.resolve(__dirname);
const repoRoot = path.resolve(packageRoot, '../..');
for (const p of [
  path.resolve(packageRoot, '.env'),
  path.resolve(repoRoot, '.env'),
  path.resolve(repoRoot, 'web/.env.local'),
]) {
  if (existsSync(p)) loadEnv({ path: p, override: false });
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? ''
  }
});
