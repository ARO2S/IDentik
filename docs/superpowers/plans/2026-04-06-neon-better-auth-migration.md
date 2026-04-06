# Neon + Better Auth Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate IDentik off Supabase entirely — swap the Postgres host to Neon (serverless HTTP driver) and replace Supabase Auth with Better Auth (Drizzle adapter, email+password, bearer plugin).

**Architecture:** The `@identik/database` package swaps its connection driver from `pg` to `@neondatabase/serverless` (HTTP mode, no WebSocket). Better Auth is installed in `web`, wired to the same Neon DB via a Drizzle adapter, and exposes a bearer-compatible session API that all existing API routes consume without change. The mobile app calls Better Auth's REST endpoints directly.

**Tech Stack:** Neon (`@neondatabase/serverless`), Drizzle ORM (`drizzle-orm/neon-http`), Better Auth (`better-auth` with Drizzle adapter + bearer plugin), Next.js 14, Expo/React Native.

---

## File Map

| File | Action |
|---|---|
| `packages/database/package.json` | Remove `pg`, `@types/pg`, `@supabase/supabase-js`; add `@neondatabase/serverless` |
| `packages/database/src/index.ts` | Replace `pg.Pool` + `drizzle-orm/node-postgres` with Neon HTTP driver |
| `packages/database/src/schema.ts` | Remove `users` table; add `user`, `session`, `account`, `verification` (Better Auth tables); update `domains.ownerUserId` FK |
| `packages/database/src/env.ts` | Remove Supabase env getters; keep `getDatabaseUrl` |
| `packages/database/src/supabase.ts` | **Delete** |
| `packages/database/drizzle.config.ts` | No change needed (uses `DATABASE_URL` directly) |
| `packages/database/scripts/seed.ts` | Remove Supabase Admin calls; look up user by email from `user` table |
| `packages/database/migrations/NNNN_*.sql` | Generated: drop `users`, add Better Auth tables, re-point FK |
| `web/package.json` | Remove `@supabase/auth-helpers-nextjs`, `@supabase/auth-helpers-react`; add `better-auth` |
| `web/src/server/better-auth.ts` | **New** — Better Auth server instance |
| `web/src/app/api/auth/[...all]/route.ts` | **New** — Better Auth Next.js handler |
| `web/src/lib/auth-client.ts` | **New** — Better Auth browser/React client |
| `web/src/server/auth.ts` | Replace Supabase `getUser` with `auth.api.getSession` |
| `web/src/server/supabase.ts` | **Delete** |
| `web/src/app/layout.tsx` | Remove `SupabaseProvider` import and wrapper |
| `web/src/components/providers/SupabaseProvider.tsx` | **Delete** |
| `web/src/components/auth/AuthPanel.tsx` | Replace `useSessionContext` with `authClient.useSession()`; swap auth calls |
| `web/src/components/forms/ProtectPhotoForm.tsx` | Replace `useSessionContext` + `session.access_token` |
| `web/src/components/forms/IdentikNameForm.tsx` | Replace `useSessionContext` + `session.access_token` |
| `mobile/package.json` | Remove `@supabase/supabase-js`, `react-native-url-polyfill`, `react-native-get-random-values` |
| `mobile/App.tsx` | Replace Supabase auth calls with Better Auth REST HTTP calls |

---

## Task 1: Install dependencies

**Files:**
- Modify: `packages/database/package.json`
- Modify: `web/package.json`
- Modify: `mobile/package.json`

- [ ] **Step 1: Update `packages/database/package.json`**

Replace the `dependencies` and `devDependencies` blocks:

```json
{
  "name": "@identik/database",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "generate": "drizzle-kit generate --config drizzle.config.ts",
    "db:migrate": "drizzle-kit migrate --config drizzle.config.ts",
    "db:seed": "tsx scripts/seed.ts"
  },
  "dependencies": {
    "@neondatabase/serverless": "^0.10.4",
    "dotenv": "^16.4.5",
    "drizzle-orm": "^0.44.7"
  },
  "devDependencies": {
    "drizzle-kit": "^0.31.7",
    "tslib": "^2.8.1",
    "tsx": "^4.19.2",
    "typescript": "^5.6.3"
  },
  "main": "src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  }
}
```

- [ ] **Step 2: Update `web/package.json` dependencies**

Remove `@supabase/auth-helpers-nextjs` and `@supabase/auth-helpers-react`; add `better-auth`:

```json
"dependencies": {
  "better-auth": "^1.2.7",
  "drizzle-orm": "^0.44.7",
  "exif-parser": "^0.1.12",
  "file-type": "^18.7.0",
  "next": "14.2.12",
  "react": "^18",
  "react-dom": "^18",
  "sharp": "^0.33.4",
  "zod": "^3.23.8"
}
```

- [ ] **Step 3: Update `mobile/package.json` dependencies**

Remove `@supabase/supabase-js`, `react-native-url-polyfill`, `react-native-get-random-values`:

```json
"dependencies": {
  "expo": "~54.0.25",
  "expo-image-picker": "~17.0.8",
  "expo-status-bar": "~3.0.8",
  "react": "19.1.0",
  "react-native": "0.81.5"
}
```

- [ ] **Step 4: Install all dependencies from repo root**

```bash
cd /home/andyr/IDentik && npm install
```

Expected: no errors. `@neondatabase/serverless` and `better-auth` appear in the respective `node_modules`.

- [ ] **Step 5: Commit**

```bash
cd /home/andyr/IDentik
git add packages/database/package.json web/package.json mobile/package.json package-lock.json
git commit -m "chore: swap supabase deps for neon + better-auth"
```

---

## Task 2: Swap the database driver

**Files:**
- Modify: `packages/database/src/index.ts`

- [ ] **Step 1: Rewrite `packages/database/src/index.ts`**

```typescript
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
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /home/andyr/IDentik/packages/database && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /home/andyr/IDentik
git add packages/database/src/index.ts
git commit -m "feat: replace pg Pool with Neon HTTP driver"
```

---

## Task 3: Rewrite the database schema

**Files:**
- Modify: `packages/database/src/schema.ts`

Remove the `users` table and its relations. Add Better Auth's four tables (`user`, `session`, `account`, `verification`). Update `domains.ownerUserId` FK to reference the new `user` table.

- [ ] **Step 1: Rewrite `packages/database/src/schema.ts`**

```typescript
import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// Better Auth tables
// ---------------------------------------------------------------------------

export const user = pgTable('user', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow()
});

export const session = pgTable('session', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expires_at').notNull(),
  token: text('token').notNull().unique(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: uuid('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' })
});

export const account = pgTable('account', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: uuid('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at'),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow()
});

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow()
});

// ---------------------------------------------------------------------------
// App tables
// ---------------------------------------------------------------------------

export const domains = pgTable(
  'domains',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull().unique(),
    ownerUserId: uuid('owner_user_id').references(() => user.id),
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    reputationScore: numeric('reputation_score').default(sql`0.5`),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default(sql`'{}'::jsonb`)
  },
  (table) => ({
    ownerUnique: uniqueIndex('domains_owner_user_id_unique')
      .on(table.ownerUserId)
      .where(sql`${table.ownerUserId} IS NOT NULL`)
  })
);

export const domainPublicKeys = pgTable('domain_public_keys', {
  id: uuid('id').defaultRandom().primaryKey(),
  domainId: uuid('domain_id').references(() => domains.id),
  keyType: text('key_type').notNull(),
  publicKey: text('public_key').notNull(),
  keyFingerprint: text('key_fingerprint').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  revoked: boolean('revoked').default(false),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default(sql`'{}'::jsonb`)
});

export const mediaRecords = pgTable('media_records', {
  id: uuid('id').defaultRandom().primaryKey(),
  domainId: uuid('domain_id').references(() => domains.id),
  fileSha256: text('file_sha256').notNull(),
  fingerprint: text('fingerprint').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default(sql`'{}'::jsonb`)
});

export const signatures = pgTable('signatures', {
  id: uuid('id').defaultRandom().primaryKey(),
  mediaId: uuid('media_id').references(() => mediaRecords.id),
  domainPublicKeyId: uuid('domain_public_key_id').references(() => domainPublicKeys.id),
  signature: text('signature').notNull(),
  algorithm: text('algorithm').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow()
});

export const verificationLogs = pgTable('verification_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  mediaId: uuid('media_id').references(() => mediaRecords.id),
  verified: boolean('verified'),
  score: numeric('score'),
  report: jsonb('report').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow()
});

export const domainEvents = pgTable('domain_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  domainId: uuid('domain_id').references(() => domains.id),
  eventType: text('event_type').notNull(),
  weight: numeric('weight').default(sql`0`),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default(sql`'{}'::jsonb`),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow()
});

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const userRelations = relations(user, ({ many }) => ({
  domains: many(domains)
}));

export const domainsRelations = relations(domains, ({ many, one }) => ({
  owner: one(user, {
    fields: [domains.ownerUserId],
    references: [user.id]
  }),
  publicKeys: many(domainPublicKeys),
  media: many(mediaRecords),
  events: many(domainEvents)
}));

export const domainPublicKeysRelations = relations(domainPublicKeys, ({ one, many }) => ({
  domain: one(domains, {
    fields: [domainPublicKeys.domainId],
    references: [domains.id]
  }),
  signatures: many(signatures)
}));

export const mediaRecordsRelations = relations(mediaRecords, ({ one, many }) => ({
  domain: one(domains, {
    fields: [mediaRecords.domainId],
    references: [domains.id]
  }),
  signatures: many(signatures),
  verificationLogs: many(verificationLogs)
}));

export const signaturesRelations = relations(signatures, ({ one }) => ({
  media: one(mediaRecords, {
    fields: [signatures.mediaId],
    references: [mediaRecords.id]
  }),
  domainPublicKey: one(domainPublicKeys, {
    fields: [signatures.domainPublicKeyId],
    references: [domainPublicKeys.id]
  })
}));

export const verificationLogsRelations = relations(verificationLogs, ({ one }) => ({
  media: one(mediaRecords, {
    fields: [verificationLogs.mediaId],
    references: [mediaRecords.id]
  })
}));

export const domainEventsRelations = relations(domainEvents, ({ one }) => ({
  domain: one(domains, {
    fields: [domainEvents.domainId],
    references: [domains.id]
  })
}));

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type User = typeof user.$inferSelect;
export type InsertUser = typeof user.$inferInsert;
export type Domain = typeof domains.$inferSelect;
export type InsertDomain = typeof domains.$inferInsert;
export type DomainPublicKey = typeof domainPublicKeys.$inferSelect;
export type MediaRecord = typeof mediaRecords.$inferSelect;
export type Signature = typeof signatures.$inferSelect;
export type VerificationLog = typeof verificationLogs.$inferSelect;
export type DomainEvent = typeof domainEvents.$inferSelect;
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /home/andyr/IDentik/packages/database && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /home/andyr/IDentik
git add packages/database/src/schema.ts
git commit -m "feat: replace users table with Better Auth schema tables"
```

---

## Task 4: Clean up database package env and supabase files

**Files:**
- Modify: `packages/database/src/env.ts`
- Delete: `packages/database/src/supabase.ts`

- [ ] **Step 1: Rewrite `packages/database/src/env.ts`**

Remove the three Supabase getters; keep only `getDatabaseUrl`:

```typescript
const required = (value: string | undefined, message: string) => {
  if (!value || value.length === 0) {
    throw new Error(message);
  }
  return value;
};

export const getDatabaseUrl = () =>
  required(process.env.DATABASE_URL, 'Set DATABASE_URL in your environment');
```

- [ ] **Step 2: Delete `packages/database/src/supabase.ts`**

```bash
rm /home/andyr/IDentik/packages/database/src/supabase.ts
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /home/andyr/IDentik/packages/database && npx tsc --noEmit
```

Expected: no errors. No remaining references to Supabase in the package.

- [ ] **Step 4: Commit**

```bash
cd /home/andyr/IDentik
git add packages/database/src/env.ts
git rm packages/database/src/supabase.ts
git commit -m "chore: remove Supabase env helpers and client from database package"
```

---

## Task 5: Remove legacy users upsert from names/purchase route

**Files:**
- Modify: `web/src/app/api/v1/names/purchase/route.ts`

The purchase route upserts the current user into the `users` table on every call. With the `users` table gone and Better Auth handling user creation at sign-up, this upsert is no longer needed and will fail to compile.

- [ ] **Step 1: Remove the upsert block from `web/src/app/api/v1/names/purchase/route.ts`**

Delete these five lines (the upsert that synced auth identity into the app users table):

```typescript
// DELETE these lines:
await db
  .insert(schema.users)
  .values({
    id: user.id,
    email: user.email,
    displayName: user.email
  })
  .onConflictDoNothing({ target: schema.users.id });
```

The handler should go straight from the `if (!user.email)` guard to parsing the request body. The section around it becomes:

```typescript
  const user = await getAuthenticatedUser(request);
  if (!user) {
    return unauthorized();
  }

  if (!user.email) {
    return badRequest('We need an email address on file before purchasing a name.');
  }

  const body = await request.json().catch(() => null);
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /home/andyr/IDentik/web && npx tsc --noEmit
```

Expected: no errors referencing `schema.users`.

- [ ] **Step 3: Commit**

```bash
cd /home/andyr/IDentik
git add web/src/app/api/v1/names/purchase/route.ts
git commit -m "feat: remove legacy users upsert from purchase route"
```

---

## Task 6: Generate and apply the Drizzle migration  <!-- was Task 5 -->

Ensure `DATABASE_URL` points to your new Neon database before running these commands.

- [ ] **Step 1: Generate the migration**

```bash
cd /home/andyr/IDentik/packages/database && npm run generate
```

Expected: a new file appears in `migrations/` (e.g. `0002_neon_better_auth.sql`). It should contain:
- `DROP TABLE "users"` (after dropping the FK)
- `ALTER TABLE "domains" DROP CONSTRAINT "domains_owner_user_id_users_id_fk"`
- `CREATE TABLE "user"` with id, name, email, email_verified, image, created_at, updated_at
- `CREATE TABLE "session"` with id, expires_at, token, user_id FK → user.id
- `CREATE TABLE "account"` with id, account_id, provider_id, user_id FK → user.id, password, etc.
- `CREATE TABLE "verification"` with id, identifier, value, expires_at
- `ALTER TABLE "domains" ADD CONSTRAINT "domains_owner_user_id_user_id_fk"` → new `user` table

Inspect the generated SQL to confirm it looks correct before running.

- [ ] **Step 2: Apply the migration**

```bash
cd /home/andyr/IDentik/packages/database && npm run db:migrate
```

Expected: migration applies cleanly. The Neon database now has the Better Auth tables and no `users` table.

- [ ] **Step 3: Commit the generated migration file**

```bash
cd /home/andyr/IDentik
git add packages/database/migrations/
git commit -m "feat: add migration for Better Auth tables, drop legacy users table"
```

---

## Task 7: Rewrite the seed script

**Files:**
- Modify: `packages/database/scripts/seed.ts`

The seed no longer uses Supabase Admin to create auth users. The demo user must already exist (created via the sign-up UI or the Better Auth API before seeding). The script looks up the user by email from the `user` table.

- [ ] **Step 1: Rewrite `packages/database/scripts/seed.ts`**

```typescript
import { closeDbPool, withDb, schema } from '../src/index.js';
import { eq } from 'drizzle-orm';
import { fingerprintPublicKey } from '@identik/crypto-utils';

const DEMO_EMAIL = process.env.SEED_DEMO_EMAIL ?? 'demo@identik.dev';
const DEMO_IDENTIK_NAME = process.env.SEED_DEMO_IDENTIK_NAME ?? 'demo.identik';
const DEV_PUBLIC_KEY = process.env.DEV_SIGNING_PUBLIC_KEY;

async function seed() {
  if (!DEV_PUBLIC_KEY) {
    throw new Error('Set DEV_SIGNING_PUBLIC_KEY before running the seed script.');
  }

  await withDb(async (db) => {
    const authUser = await db.query.user.findFirst({
      where: eq(schema.user.email, DEMO_EMAIL)
    });

    if (!authUser) {
      throw new Error(
        `No user found with email "${DEMO_EMAIL}". Sign up via the web UI first, then run the seed.`
      );
    }

    const keyFingerprint = fingerprintPublicKey(DEV_PUBLIC_KEY);

    const existingDomain = await db.query.domains.findFirst({
      where: eq(schema.domains.name, DEMO_IDENTIK_NAME)
    });

    const domain =
      existingDomain ??
      (
        await db
          .insert(schema.domains)
          .values({ name: DEMO_IDENTIK_NAME, ownerUserId: authUser.id, status: 'active' })
          .returning()
      )[0];

    const existingKey = await db.query.domainPublicKeys.findFirst({
      where: eq(schema.domainPublicKeys.keyFingerprint, keyFingerprint)
    });

    const domainKey =
      existingKey ??
      (
        await db
          .insert(schema.domainPublicKeys)
          .values({
            domainId: domain.id,
            keyType: 'ed25519',
            publicKey: DEV_PUBLIC_KEY,
            keyFingerprint,
            metadata: { seeded: true }
          })
          .returning()
      )[0];

    const [media] = await db
      .insert(schema.mediaRecords)
      .values({
        domainId: domain.id,
        fileSha256: 'demo-file-sha',
        fingerprint: 'demo-fingerprint',
        metadata: { note: 'Seeded media record' }
      })
      .onConflictDoNothing()
      .returning();

    await db.insert(schema.domainEvents).values([
      { domainId: domain.id, eventType: 'media_signed', weight: '1', metadata: { seeded: true } },
      { domainId: domain.id, eventType: 'verification_pass', weight: '0.5', metadata: { seeded: true } }
    ]);

    await db
      .insert(schema.verificationLogs)
      .values({
        mediaId: media?.id ?? null,
        verified: true,
        score: '0.9',
        report: { seeded: true }
      })
      .onConflictDoNothing();

    console.info(`Seeded Identik Name (${DEMO_IDENTIK_NAME}) for user ${DEMO_EMAIL}.`);
    void domainKey;
  });

  await closeDbPool();
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /home/andyr/IDentik/packages/database && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /home/andyr/IDentik
git add packages/database/scripts/seed.ts
git commit -m "feat: rewrite seed script to use Better Auth user table"
```

---

## Task 8: Create the Better Auth server instance and route handler

**Files:**
- Create: `web/src/server/better-auth.ts`
- Create: `web/src/app/api/auth/[...all]/route.ts`
- Delete: `web/src/server/supabase.ts`

- [ ] **Step 1: Create `web/src/server/better-auth.ts`**

```typescript
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { bearer } from 'better-auth/plugins';
import { getDb, schema } from '@identik/database';

export const auth = betterAuth({
  database: drizzleAdapter(getDb(), {
    provider: 'pg',
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification
    }
  }),
  emailAndPassword: {
    enabled: true
  },
  plugins: [bearer()],
  advanced: {
    generateId: () => crypto.randomUUID()
  }
});
```

- [ ] **Step 2: Create `web/src/app/api/auth/[...all]/route.ts`**

```typescript
import { auth } from '@/server/better-auth';
import { toNextJsHandler } from 'better-auth/next-js';

export const { GET, POST } = toNextJsHandler(auth);
```

- [ ] **Step 3: Delete `web/src/server/supabase.ts`**

```bash
rm /home/andyr/IDentik/web/src/server/supabase.ts
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd /home/andyr/IDentik/web && npx tsc --noEmit
```

Expected: no errors from the new files. There will be errors in files that still import from Supabase — those are fixed in later tasks.

- [ ] **Step 5: Commit**

```bash
cd /home/andyr/IDentik
git add web/src/server/better-auth.ts web/src/app/api/auth/
git rm web/src/server/supabase.ts
git commit -m "feat: add Better Auth server instance and Next.js route handler"
```

---

## Task 9: Create the Better Auth browser client and update the layout

**Files:**
- Create: `web/src/lib/auth-client.ts`
- Modify: `web/src/app/layout.tsx`
- Delete: `web/src/components/providers/SupabaseProvider.tsx`

- [ ] **Step 1: Create `web/src/lib/auth-client.ts`**

```typescript
import { createAuthClient } from 'better-auth/react';

export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
});
```

- [ ] **Step 2: Rewrite `web/src/app/layout.tsx`**

Remove the `SupabaseProvider` import and wrapper. No replacement provider is needed — Better Auth's React client works without a context provider.

```typescript
import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter'
});

export const metadata: Metadata = {
  title: 'Identik – Trusted identity for trusted media',
  description: 'Protect and verify photos with a simple Identik Name.',
  icons: {
    icon: [
      { url: '/assets/favicon-32.png', type: 'image/png', sizes: '32x32' },
      { url: '/assets/favicon-16.png', type: 'image/png', sizes: '16x16' }
    ],
    apple: [{ url: '/assets/apple-touch-icon-180.svg', sizes: '180x180' }],
    shortcut: ['/assets/identik_icon_shield_64.png'],
    other: [{ rel: 'mask-icon', url: '/assets/identik_icon_shield_128.svg', color: '#0d1b2a' }]
  }
};

export default function RootLayout({
  children
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${inter.variable} page-shell`}>{children}</body>
    </html>
  );
}
```

- [ ] **Step 3: Delete `web/src/components/providers/SupabaseProvider.tsx`**

```bash
rm /home/andyr/IDentik/web/src/components/providers/SupabaseProvider.tsx
```

- [ ] **Step 4: Commit**

```bash
cd /home/andyr/IDentik
git add web/src/lib/auth-client.ts web/src/app/layout.tsx
git rm web/src/components/providers/SupabaseProvider.tsx
git commit -m "feat: add Better Auth browser client, remove SupabaseProvider"
```

---

## Task 10: Update server-side auth

**Files:**
- Modify: `web/src/server/auth.ts`

- [ ] **Step 1: Rewrite `web/src/server/auth.ts`**

```typescript
import { auth } from '@/server/better-auth';
import type { NextRequest } from 'next/server';

export interface AuthenticatedUser {
  id: string;
  email?: string | null;
}

export const getAuthenticatedUser = async (request: NextRequest): Promise<AuthenticatedUser | null> => {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return null;
  return {
    id: session.user.id,
    email: session.user.email
  };
};
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /home/andyr/IDentik/web && npx tsc --noEmit
```

Expected: errors only in the three client components that still import from `@supabase/auth-helpers-react` — those are fixed next.

- [ ] **Step 3: Commit**

```bash
cd /home/andyr/IDentik
git add web/src/server/auth.ts
git commit -m "feat: replace Supabase getUser with Better Auth getSession"
```

---

## Task 11: Rewrite AuthPanel

**Files:**
- Modify: `web/src/components/auth/AuthPanel.tsx`

`useSessionContext` → `authClient.useSession()`. `session.access_token` → `sessionData?.session?.token`. Auth calls → `authClient.signIn.email`, `authClient.signUp.email`, `authClient.signOut`.

- [ ] **Step 1: Rewrite `web/src/components/auth/AuthPanel.tsx`**

```typescript
'use client';

import { authClient } from '@/lib/auth-client';
import { useCallback, useEffect, useState } from 'react';
import IdentikNameForm from '@/components/forms/IdentikNameForm';

type NameStatus = 'idle' | 'loading' | 'ready' | 'error';

const statusClass = (status: 'success' | 'error') =>
  status === 'success' ? 'status-banner status-success' : 'status-banner status-danger';

export const AuthPanel = () => {
  const { data: sessionData, isPending } = authClient.useSession();
  const session = sessionData ?? null;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [nameStatus, setNameStatus] = useState<NameStatus>('idle');
  const [ownedName, setOwnedName] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [showClaimModal, setShowClaimModal] = useState(false);

  const token = session?.session?.token ?? null;

  const fetchOwnedName = useCallback(async () => {
    if (!token) return;
    setNameStatus('loading');
    setNameError(null);
    try {
      const res = await fetch('/api/v1/names/mine', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error ?? 'Unable to load your Identik Name.');
      }
      setOwnedName(data?.owned ? data.identik_name ?? null : null);
      setNameStatus('ready');
    } catch (error) {
      setOwnedName(null);
      setNameStatus('error');
      setNameError(error instanceof Error ? error.message : 'Unable to load your Identik Name.');
    }
  }, [token]);

  useEffect(() => {
    let cancelled = false;

    if (!token) {
      setOwnedName(null);
      setNameStatus('idle');
      setNameError(null);
      return;
    }

    const loadOwnedName = async () => {
      await fetchOwnedName();
      if (cancelled) return;
    };

    loadOwnedName();

    return () => {
      cancelled = true;
    };
  }, [token, fetchOwnedName]);

  const signIn = async (event: React.FormEvent) => {
    event.preventDefault();
    setStatus(null);
    setIsSubmitting(true);
    try {
      const { error } = await authClient.signIn.email({ email, password });
      if (error) throw new Error(error.message);
      setStatus({ type: 'success', message: 'Signed in. You can now protect photos under your Identik Name.' });
    } catch (error) {
      setStatus({ type: 'error', message: error instanceof Error ? error.message : 'Unable to sign in.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const register = async () => {
    setStatus(null);
    setIsSubmitting(true);
    try {
      const { error } = await authClient.signUp.email({ email, password, name: email });
      if (error) throw new Error(error.message);
      setStatus({ type: 'success', message: 'Account created. Check your email to verify and continue.' });
    } catch (error) {
      setStatus({ type: 'error', message: error instanceof Error ? error.message : 'Unable to register.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const signOut = async () => {
    await authClient.signOut();
    setStatus({ type: 'success', message: 'Signed out.' });
    setOwnedName(null);
    setNameStatus('idle');
    setNameError(null);
    setShowClaimModal(false);
  };

  const handleClaimed = (name: string) => {
    setOwnedName(name);
    setNameStatus('ready');
    setShowClaimModal(false);
    setStatus({ type: 'success', message: `You now own ${name}.` });
  };

  if (isPending) {
    return <div className="card">Loading session…</div>;
  }

  return (
    <div className="card auth-panel-card">
      <div className="auth-panel-header">
        <h3>{session ? 'You are signed in' : 'Access your Identik account'}</h3>
        <p className="auth-panel-subhead">
          {session
            ? 'Claim or view your Identik Name, then start protecting photos.'
            : 'Sign in with your Identik email, or create an account to claim your Identik Name.'}
        </p>
      </div>
      {session ? (
        <div className="auth-panel-session">
          <div className="auth-session-meta">
            <p className="eyebrow">Signed in</p>
            <p className="auth-session-email">{session.user.email}</p>
          </div>

          <div className="auth-domain-box">
            <div className="auth-domain-head">
              <span>Your Identik Name</span>
              {nameStatus === 'loading' && <span className="status-pill muted">Checking…</span>}
              {nameStatus === 'ready' && ownedName && <span className="status-pill success">Claimed</span>}
              {nameStatus === 'ready' && !ownedName && <span className="status-pill warning">Not claimed</span>}
            </div>

            {nameStatus === 'error' && (
              <div className="status-banner status-danger" role="status">
                {nameError}
              </div>
            )}

            {nameStatus === 'loading' && <p className="auth-panel-footnote">Checking your claim status…</p>}

            {nameStatus === 'ready' && ownedName && (
              <div className="domain-pill" aria-live="polite">
                {ownedName}
              </div>
            )}

            {nameStatus === 'ready' && !ownedName && (
              <div className="auth-domain-empty">
                <p>You haven't claimed an Identik Name yet.</p>
                <p className="auth-panel-footnote">
                  Claim a domain like <strong>yourname.identik</strong> before protecting photos.
                </p>
                <button type="button" className="primary-btn" onClick={() => setShowClaimModal(true)}>
                  Claim your Identik Name
                </button>
              </div>
            )}
          </div>

          <div className="cta-row auth-panel-actions">
            <a className="secondary-btn" href="#protect-photo">
              Protect a photo
            </a>
            <button type="button" className="secondary-btn" onClick={signOut}>
              Sign out
            </button>
          </div>
        </div>
      ) : (
        <form className="auth-panel-form" onSubmit={signIn}>
          <div>
            <label htmlFor="login-email">Email</label>
            <input
              id="login-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              required
            />
            <p className="input-helper">Use the email you'll verify with Identik.</p>
          </div>
          <div>
            <label htmlFor="login-password">Password</label>
            <input
              id="login-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="••••••••"
              required
            />
            <p className="input-helper">Create at least 8 characters. New here? This will create your account.</p>
          </div>
          <div className="cta-row auth-panel-actions">
            <button type="submit" className="primary-btn" disabled={isSubmitting}>
              {isSubmitting ? 'Signing in…' : 'Sign in'}
            </button>
            <button type="button" className="secondary-btn" onClick={register} disabled={isSubmitting}>
              Create account
            </button>
          </div>

          <p className="auth-panel-footnote">
            After signing in, you'll see whether you've already claimed an Identik Name—and if not, you can claim one in
            the box right away.
          </p>
        </form>
      )}
      {status && (
        <div className={statusClass(status.type)} role="status">
          {status.message}
        </div>
      )}

      {showClaimModal && (
        <div className="modal-backdrop" role="presentation" onClick={() => setShowClaimModal(false)}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="claim-identik-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <h4 id="claim-identik-title">Claim your Identik Name</h4>
              <button
                type="button"
                className="modal-close"
                aria-label="Close claim dialog"
                onClick={() => setShowClaimModal(false)}
              >
                ×
              </button>
            </div>
            <p className="modal-subhead">
              Reserve and purchase your Identik Name in one place. You'll use this to protect photos.
            </p>
            <IdentikNameForm onClaimed={handleClaimed} />
          </div>
        </div>
      )}
    </div>
  );
};

export default AuthPanel;
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /home/andyr/IDentik/web && npx tsc --noEmit
```

Expected: errors only in `ProtectPhotoForm.tsx` and `IdentikNameForm.tsx` (next task).

- [ ] **Step 3: Commit**

```bash
cd /home/andyr/IDentik
git add web/src/components/auth/AuthPanel.tsx
git commit -m "feat: replace Supabase session hooks with Better Auth in AuthPanel"
```

---

## Task 12: Update ProtectPhotoForm and IdentikNameForm

**Files:**
- Modify: `web/src/components/forms/ProtectPhotoForm.tsx`
- Modify: `web/src/components/forms/IdentikNameForm.tsx`

Both files use `useSessionContext` from `@supabase/auth-helpers-react` and read `session.access_token`. Replace with `authClient.useSession()` and `session?.session?.token`.

- [ ] **Step 1: Update the import and session hook in `ProtectPhotoForm.tsx`**

Replace the top of the file (imports + the `session` destructure):

```typescript
'use client';

import { authClient } from '@/lib/auth-client';
import { useEffect, useRef, useState } from 'react';
```

Replace the session line inside the component:

```typescript
const { data: sessionData } = authClient.useSession();
const token = sessionData?.session?.token ?? null;
```

Replace every occurrence of `session?.access_token` with `token` and every occurrence of `session.access_token` with `token`. The guard `if (!session?.access_token)` becomes `if (!token)`.

The full updated component:

```typescript
'use client';

import { authClient } from '@/lib/auth-client';
import { useEffect, useRef, useState } from 'react';

const statusToClass = (status: 'success' | 'error' | 'info') => {
  if (status === 'success') return 'status-banner status-success';
  if (status === 'error') return 'status-banner status-danger';
  return 'status-banner status-caution';
};

const getFileNameFromContentDisposition = (headerValue: string | null): string | null => {
  if (!headerValue) return null;

  const filenameStarMatch = headerValue.match(/filename\*=([^']*)''([^;]+)/i);
  if (filenameStarMatch?.[2]) {
    try {
      return decodeURIComponent(filenameStarMatch[2]);
    } catch {
      return filenameStarMatch[2];
    }
  }

  const quotedFilenameMatch = headerValue.match(/filename="([^"]+)"/i);
  if (quotedFilenameMatch?.[1]) {
    return quotedFilenameMatch[1];
  }

  const fallbackMatch = headerValue.match(/filename=([^;]+)/i);
  if (fallbackMatch?.[1]) {
    const value = fallbackMatch[1].trim().replace(/^['"]|['"]$/g, '');
    return value || null;
  }

  return null;
};

export const ProtectPhotoForm = () => {
  const { data: sessionData } = authClient.useSession();
  const token = sessionData?.session?.token ?? null;
  const formRef = useRef<HTMLFormElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [status, setStatus] = useState<{ kind: 'success' | 'error' | 'info'; message: string } | null>(null);
  const [includeWatermark, setIncludeWatermark] = useState(true);
  const [identikName, setIdentikName] = useState('');
  const [claimedName, setClaimedName] = useState<string | null>(null);
  const [nameStatus, setNameStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [nameError, setNameError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (!token) {
      setIdentikName('');
      setClaimedName(null);
      setNameStatus('idle');
      setNameError(null);
      return;
    }

    const loadOwnedName = async () => {
      setNameStatus('loading');
      setNameError(null);
      try {
        const res = await fetch('/api/v1/names/mine', {
          headers: { Authorization: `Bearer ${token}` }
        });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          throw new Error(data?.error ?? 'Unable to load your Identik Name.');
        }
        const owned = data?.owned ? data.identik_name ?? '' : '';
        setClaimedName(owned || null);
        setIdentikName(owned);
        setNameStatus('ready');
      } catch (error) {
        if (cancelled) return;
        setClaimedName(null);
        setNameStatus('error');
        setNameError(error instanceof Error ? error.message : 'Unable to load your Identik Name.');
      }
    };

    loadOwnedName();

    return () => {
      cancelled = true;
    };
  }, [token]);

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = formRef.current;
    if (!form) return;

    const formData = new FormData(form);
    const identikNameValue = identikName.trim();
    const file = fileInputRef.current?.files?.[0];

    if (!identikNameValue) {
      setStatus({ kind: 'error', message: 'Please enter your Identik Name.' });
      return;
    }

    if (!file) {
      setStatus({ kind: 'error', message: 'Please choose the photo or video you want to protect.' });
      return;
    }

    if (!token) {
      setStatus({ kind: 'error', message: 'Please sign in before protecting a photo or video.' });
      return;
    }

    setIsSubmitting(true);
    setStatus(null);

    try {
      formData.set('identikName', identikNameValue);
      formData.set('watermark', includeWatermark ? 'true' : 'false');
      const response = await fetch('/api/v1/sign', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData
      });

      if (!response.ok) {
        const error = await response
          .json()
          .catch(() => ({ error: 'Unable to protect that photo or video right now.' }));
        throw new Error(error?.error ?? 'Unable to protect that photo or video right now.');
      }

      const contentDisposition = response.headers.get('content-disposition');
      const downloadFileName = getFileNameFromContentDisposition(contentDisposition);
      const summaryHeader = response.headers.get('x-identik-summary');
      const summary = summaryHeader ? JSON.parse(summaryHeader) : null;
      const blob = await response.blob();
      const downloadUrl = URL.createObjectURL(blob);
      const summaryMediaType = summary?.media_type ?? summary?.mediaType;
      const defaultExt =
        summary?.mimeType?.startsWith('video/') || summaryMediaType === 'video' ? 'mp4' : 'jpg';
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download =
        downloadFileName ??
        (summary?.identik_name
          ? `protected-${summary.identik_name}.${defaultExt}`
          : `protected-${Date.now()}.${defaultExt}`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(downloadUrl);

      setStatus({
        kind: 'success',
        message: summary
          ? `All set! This photo or video is now protected under ${summary.identik_name}. ${
              summary.watermark_applied
                ? 'We added the subtle Identik watermark to your download.'
                : 'This download keeps the original pixels untouched.'
            }`
          : 'All set! This photo or video is now protected.'
      });
      setIdentikName(summary?.identik_name ?? identikNameValue);
      setIncludeWatermark(true);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (error) {
      setStatus({
        kind: 'error',
        message: error instanceof Error ? error.message : 'We could not protect that photo or video right now.'
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form ref={formRef} onSubmit={onSubmit} aria-label="Protect a photo or video">
      <div>
        <label htmlFor="protect-identik-name">
          Your Identik Name{' '}
          {claimedName && (
            <span className="status-pill success" style={{ marginLeft: '0.35rem' }}>
              Claimed
            </span>
          )}
        </label>
        <input
          id="protect-identik-name"
          name="identikName"
          type="text"
          placeholder="jenny.identik"
          value={identikName}
          onChange={(event) => setIdentikName(event.target.value)}
          readOnly={Boolean(claimedName)}
        />
        {nameStatus === 'loading' && token && <p className="form-helper">Loading your Identik Name…</p>}
        {nameStatus === 'error' && (
          <div className="status-banner status-danger" role="status">
            {nameError}
          </div>
        )}
        {claimedName && (
          <p className="form-helper">Auto-filled from your account. Each account uses one Identik Name.</p>
        )}
      </div>
      <div>
        <label htmlFor="protect-file">Photo or video to protect</label>
        <input id="protect-file" name="file" type="file" accept="image/*,video/*" ref={fileInputRef} />
      </div>
      <div className="watermark-toggle">
        <label htmlFor="protect-watermark" className="checkbox-row">
          <input
            id="protect-watermark"
            name="watermark"
            type="checkbox"
            checked={includeWatermark}
            onChange={(event) => setIncludeWatermark(event.target.checked)}
          />
          <span>Add the Identik shield watermark to this download</span>
        </label>
        <p className="form-helper">
          Uncheck if you prefer the untouched photo. Videos are always returned without a watermark. You can always rerun
          protect to grab the other version.
        </p>
      </div>
      <button type="submit" className="primary-btn" disabled={isSubmitting}>
        {isSubmitting ? 'Protecting…' : 'Protect this photo or video'}
      </button>
      {status && (
        <div className={statusToClass(status.kind)} role="status">
          {status.message}
        </div>
      )}
    </form>
  );
};

export default ProtectPhotoForm;
```

- [ ] **Step 2: Update `IdentikNameForm.tsx`**

Replace the import and session hook. The full updated component:

```typescript
'use client';

import { authClient } from '@/lib/auth-client';
import { useEffect, useState } from 'react';

const NAME_SUFFIX = '.identik';

type Props = {
  onClaimed?: (identikName: string) => void;
};

type Banner = {
  status: 'success' | 'error' | 'info';
  message: string;
};

const statusToClass = (status: Banner['status']) => {
  if (status === 'success') return 'status-banner status-success';
  if (status === 'error') return 'status-banner status-danger';
  return 'status-banner status-caution';
};

const formatLabel = (value: string) => value.trim().toLowerCase().replace(/\s+/g, '-');

export const IdentikNameForm = ({ onClaimed }: Props) => {
  const { data: sessionData } = authClient.useSession();
  const token = sessionData?.session?.token ?? null;
  const [name, setName] = useState('');
  const [banner, setBanner] = useState<Banner | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [isActivating, setIsActivating] = useState(false);
  const [ownedName, setOwnedName] = useState<string | null>(null);
  const [ownershipStatus, setOwnershipStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [ownershipError, setOwnershipError] = useState<string | null>(null);

  const label = formatLabel(name);
  const identikName = label ? `${label}${NAME_SUFFIX}` : '';
  const hasDifferentOwnedName = Boolean(ownedName && identikName && ownedName !== identikName);

  useEffect(() => {
    let cancelled = false;

    if (!token) {
      setOwnedName(null);
      setOwnershipStatus('idle');
      setOwnershipError(null);
      return;
    }

    const loadOwnedName = async () => {
      setOwnershipStatus('loading');
      setOwnershipError(null);
      try {
        const res = await fetch('/api/v1/names/mine', {
          headers: { Authorization: `Bearer ${token}` }
        });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          throw new Error(data?.error ?? 'Unable to load your Identik Name.');
        }
        setOwnedName(data?.owned ? data.identik_name ?? null : null);
        setOwnershipStatus('ready');
      } catch (error) {
        if (cancelled) return;
        setOwnedName(null);
        setOwnershipStatus('error');
        setOwnershipError(error instanceof Error ? error.message : 'Unable to load your Identik Name.');
      }
    };

    loadOwnedName();

    return () => {
      cancelled = true;
    };
  }, [token]);

  const checkAvailability = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!label) {
      setBanner({ status: 'error', message: 'Please enter a name to check.' });
      return;
    }
    setIsChecking(true);
    setBanner(null);
    try {
      const res = await fetch(`/api/v1/names/available?name=${encodeURIComponent(label)}`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error ?? 'Unable to check name right now.');
      }
      if (data.available) {
        setBanner({ status: 'success', message: `${data.identik_name} is ready for you.` });
      } else {
        setBanner({ status: 'info', message: `${data.identik_name} is already taken.` });
      }
    } catch (error) {
      setBanner({ status: 'error', message: error instanceof Error ? error.message : 'Something went wrong.' });
    } finally {
      setIsChecking(false);
    }
  };

  const activateName = async () => {
    if (!label) {
      setBanner({ status: 'error', message: 'Please enter a name to activate.' });
      return;
    }
    if (!token) {
      setBanner({ status: 'error', message: 'Please sign in before activating your Identik Name.' });
      return;
    }
    if (hasDifferentOwnedName) {
      setBanner({
        status: 'info',
        message: `You already own ${ownedName}. Each account gets one Identik Name.`
      });
      return;
    }
    setIsActivating(true);
    setBanner(null);
    try {
      const res = await fetch('/api/v1/names/purchase', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ name: label })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error ?? 'Unable to activate that Identik Name right now.');
      }
      const claimedName = data.identik_name ?? identikName;
      setOwnedName(claimedName);
      setOwnershipStatus('ready');
      setBanner({ status: 'success', message: `You now own ${claimedName}.` });
      onClaimed?.(claimedName);
    } catch (error) {
      setBanner({
        status: 'error',
        message:
          error instanceof Error
            ? error.message
            : 'We could not activate that Identik Name. Please try again after signing in.'
      });
    } finally {
      setIsActivating(false);
    }
  };

  return (
    <form className="identik-name-form" onSubmit={checkAvailability} aria-label="Create Identik Name">
      <div>
        <label htmlFor="identik-name">Pick your Identik Name</label>
        <input
          id="identik-name"
          type="text"
          placeholder="e.g. jenny"
          value={name}
          onChange={(event) => setName(event.target.value)}
          aria-describedby="identik-name-help"
        />
        <small id="identik-name-help" style={{ color: 'var(--text-muted)' }}>
          Letters, numbers, and dashes only. We'll add {NAME_SUFFIX} for you. Each account can claim one Identik Name.
        </small>
      </div>

      {identikName && (
        <div className="input-like" aria-live="polite">
          Your Identik Name will be <strong>{identikName}</strong>
        </div>
      )}

      {ownershipStatus === 'loading' && token && (
        <div className="status-banner status-caution" role="status">
          Checking if you already claimed a name…
        </div>
      )}

      {ownershipError && (
        <div className="status-banner status-danger" role="status">
          {ownershipError}
        </div>
      )}

      {ownedName && (
        <div className="status-banner status-success" role="status">
          <p style={{ margin: 0 }}>You already own</p>
          <strong style={{ display: 'block' }}>{ownedName}</strong>
          <p style={{ margin: 0 }}>Use this Identik Name when protecting photos.</p>
        </div>
      )}

      {hasDifferentOwnedName && (
        <div className="status-banner status-caution" role="status">
          Each account gets one Identik Name. You already claimed {ownedName}.
        </div>
      )}

      <div className="cta-row">
        <button type="submit" className="primary-btn" disabled={isChecking}>
          {isChecking ? 'Checking…' : 'Check availability'}
        </button>
        <button
          type="button"
          className="secondary-btn"
          onClick={activateName}
          disabled={isActivating || hasDifferentOwnedName}
        >
          {hasDifferentOwnedName ? 'One name per account' : isActivating ? 'Activating…' : 'Activate name'}
        </button>
      </div>

      {banner && (
        <div className={statusToClass(banner.status)} role="status">
          {banner.message}
        </div>
      )}
    </form>
  );
};

export default IdentikNameForm;
```

- [ ] **Step 3: Verify TypeScript compiles clean**

```bash
cd /home/andyr/IDentik/web && npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
cd /home/andyr/IDentik
git add web/src/components/forms/ProtectPhotoForm.tsx web/src/components/forms/IdentikNameForm.tsx
git commit -m "feat: replace Supabase session hooks with Better Auth in form components"
```

---

## Task 13: Rewrite the mobile app

**Files:**
- Modify: `mobile/App.tsx`

Remove `@supabase/supabase-js` entirely. Replace auth calls with direct `fetch` to Better Auth's REST endpoints at `EXPO_PUBLIC_API_URL`. The session token from sign-in is stored in component state and passed as `Authorization: Bearer <token>`.

- [ ] **Step 1: Rewrite `mobile/App.tsx`**

```typescript
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import {
  Alert,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';

const apiBaseUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

type AuthSession = {
  token: string;
  user: { id: string; email: string; name: string };
};

type PickedImage = {
  uri: string;
  name: string;
  type: string;
};

type VerifyResult = {
  verified: boolean;
  label: 'Trusted' | 'Limited history' | 'Warning' | 'Not protected';
  message: string;
  identik_name?: string | null;
};

export default function App() {
  const [email, setEmail] = useState('demo@identik.dev');
  const [password, setPassword] = useState('identik-demo');
  const [session, setSession] = useState<AuthSession | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [identikName, setIdentikName] = useState('demo.identik');
  const [protectImage, setProtectImage] = useState<PickedImage | null>(null);
  const [protectStatus, setProtectStatus] = useState<string | null>(null);
  const [protectLoading, setProtectLoading] = useState(false);

  const [checkImage, setCheckImage] = useState<PickedImage | null>(null);
  const [verifyStatus, setVerifyStatus] = useState<VerifyResult | null>(null);
  const [verifyLoading, setVerifyLoading] = useState(false);

  const signIn = async () => {
    setIsSubmitting(true);
    try {
      const res = await fetch(`${apiBaseUrl}/api/auth/sign-in/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message ?? 'Sign-in failed.');
      setSession({ token: data.token, user: data.user });
      Alert.alert('Signed in', 'You can now activate Identik Names and protect photos.');
    } catch (error) {
      Alert.alert('Sign-in failed', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const register = async () => {
    setIsSubmitting(true);
    try {
      const res = await fetch(`${apiBaseUrl}/api/auth/sign-up/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, name: email })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message ?? 'Registration failed.');
      Alert.alert('Check your inbox', 'Verify your email to finish creating your Identik account.');
    } catch (error) {
      Alert.alert('Registration failed', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const signOut = async () => {
    if (session) {
      await fetch(`${apiBaseUrl}/api/auth/sign-out`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.token}` }
      }).catch(() => {});
    }
    setSession(null);
    Alert.alert('Signed out', 'You are signed out of Identik on this device.');
  };

  const pickImage = async (setImage: (value: PickedImage | null) => void) => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Allow Identik to access your photo library.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 1
    });
    if (!result.canceled && result.assets?.[0]) {
      const asset = result.assets[0];
      setImage({
        uri: asset.uri,
        name: asset.fileName ?? `photo-${Date.now()}.jpg`,
        type: asset.mimeType ?? 'image/jpeg'
      });
    }
  };

  const protectPhoto = async () => {
    if (!session) {
      Alert.alert('Sign in required', 'Sign in before protecting a photo.');
      return;
    }
    if (!protectImage) {
      Alert.alert('Select a photo', 'Choose a photo to protect.');
      return;
    }
    if (!identikName.trim()) {
      Alert.alert('Add Identik Name', 'Enter the Identik Name you want to sign as.');
      return;
    }
    setProtectLoading(true);
    setProtectStatus(null);
    try {
      const formData = new FormData();
      formData.append('identikName', identikName.trim());
      formData.append('file', {
        uri: protectImage.uri,
        name: protectImage.name,
        type: protectImage.type
      } as unknown as Blob);

      const response = await fetch(`${apiBaseUrl}/api/v1/sign`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.token}` },
        body: formData
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unable to protect that photo right now.' }));
        throw new Error(error?.error ?? 'Unable to protect that photo right now.');
      }

      const summaryHeader = response.headers.get('x-identik-summary');
      const summary = summaryHeader ? JSON.parse(summaryHeader) : null;
      setProtectStatus(
        summary?.identik_name
          ? `Photo protected under ${summary.identik_name}. Download the signed copy from the web app.`
          : 'Photo protected successfully.'
      );
    } catch (error) {
      Alert.alert('Protect failed', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setProtectLoading(false);
    }
  };

  const checkPhoto = async () => {
    if (!checkImage) {
      Alert.alert('Select a photo', 'Choose a photo to check.');
      return;
    }
    setVerifyLoading(true);
    setVerifyStatus(null);
    try {
      const formData = new FormData();
      formData.append('file', {
        uri: checkImage.uri,
        name: checkImage.name,
        type: checkImage.type
      } as unknown as Blob);

      const response = await fetch(`${apiBaseUrl}/api/v1/verify`, {
        method: 'POST',
        body: formData
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error ?? 'Unable to check that photo right now.');
      }

      setVerifyStatus(data as VerifyResult);
    } catch (error) {
      Alert.alert('Check failed', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setVerifyLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.title}>Identik</Text>
        <Text style={styles.subtitle}>Trusted identity for trusted media.</Text>
        <View style={styles.card}>
          {session ? (
            <>
              <Text style={styles.cardTitle}>Signed in as</Text>
              <Text style={styles.signedInEmail}>{session.user.email}</Text>
              <TouchableOpacity style={styles.secondaryBtn} onPress={signOut}>
                <Text style={styles.secondaryBtnText}>Sign out</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={styles.cardTitle}>Sign in to Identik</Text>
              <TextInput
                style={styles.input}
                placeholder="you@example.com"
                placeholderTextColor="#8ea0bd"
                autoCapitalize="none"
                keyboardType="email-address"
                value={email}
                onChangeText={setEmail}
              />
              <TextInput
                style={styles.input}
                placeholder="Password"
                placeholderTextColor="#8ea0bd"
                secureTextEntry
                value={password}
                onChangeText={setPassword}
              />
              <TouchableOpacity style={styles.primaryBtn} onPress={signIn} disabled={isSubmitting}>
                <Text style={styles.primaryBtnText}>{isSubmitting ? 'Please wait…' : 'Sign in'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.secondaryBtn} onPress={register} disabled={isSubmitting}>
                <Text style={styles.secondaryBtnText}>Create account</Text>
              </TouchableOpacity>
            </>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Protect a photo</Text>
          <TextInput
            style={styles.input}
            placeholder="jenny.identik"
            placeholderTextColor="#8ea0bd"
            value={identikName}
            onChangeText={setIdentikName}
          />
          <TouchableOpacity style={styles.secondaryBtn} onPress={() => pickImage(setProtectImage)}>
            <Text style={styles.secondaryBtnText}>
              {protectImage ? 'Replace selected photo' : 'Choose a photo to protect'}
            </Text>
          </TouchableOpacity>
          {protectStatus && <Text style={styles.helperTextDark}>{protectStatus}</Text>}
          <TouchableOpacity style={styles.primaryBtn} onPress={protectPhoto} disabled={protectLoading}>
            <Text style={styles.primaryBtnText}>{protectLoading ? 'Protecting…' : 'Protect this photo'}</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Check a photo</Text>
          <TouchableOpacity style={styles.secondaryBtn} onPress={() => pickImage(setCheckImage)}>
            <Text style={styles.secondaryBtnText}>
              {checkImage ? 'Replace selected photo' : 'Choose a photo to check'}
            </Text>
          </TouchableOpacity>
          {verifyStatus && (
            <View style={styles.verifyBadge}>
              <Text style={styles.verifyBadgeTitle}>{verifyStatus.label}</Text>
              <Text style={styles.verifyBadgeText}>{verifyStatus.message}</Text>
              {verifyStatus.identik_name && (
                <Text style={styles.verifyBadgeText}>Identik Name: {verifyStatus.identik_name}</Text>
              )}
            </View>
          )}
          <TouchableOpacity style={styles.primaryBtn} onPress={checkPhoto} disabled={verifyLoading}>
            <Text style={styles.primaryBtnText}>{verifyLoading ? 'Checking…' : 'Check this photo'}</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#0d1b2a' },
  scrollContent: { padding: 24, gap: 20 },
  title: { color: '#ffffff', fontSize: 32, fontWeight: '700' },
  subtitle: { color: 'rgba(255,255,255,0.8)', marginBottom: 8 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 24,
    padding: 20,
    gap: 14,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowOffset: { width: 0, height: 10 },
    shadowRadius: 20
  },
  cardTitle: { fontSize: 18, fontWeight: '600' },
  signedInEmail: { fontSize: 16, marginBottom: 12 },
  input: {
    borderWidth: 1,
    borderColor: '#d1d8e5',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16
  },
  primaryBtn: { backgroundColor: '#1a4d8f', borderRadius: 999, paddingVertical: 12, alignItems: 'center' },
  primaryBtnText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  secondaryBtn: { borderRadius: 999, borderWidth: 2, borderColor: '#00c2a8', paddingVertical: 12, alignItems: 'center' },
  secondaryBtnText: { color: '#00c2a8', fontWeight: '600' },
  helperTextDark: { color: '#4a5668' },
  verifyBadge: { backgroundColor: 'rgba(13,27,42,0.05)', padding: 12, borderRadius: 16, gap: 4 },
  verifyBadgeTitle: { fontWeight: '700', fontSize: 16 },
  verifyBadgeText: { color: '#4a5668' }
});
```

- [ ] **Step 2: Commit**

```bash
cd /home/andyr/IDentik
git add mobile/App.tsx mobile/package.json
git commit -m "feat: replace Supabase auth with Better Auth REST API in mobile app"
```

---

## Task 14: Set environment variables and do a final build check

- [ ] **Step 1: Add required env vars to `web/.env.local`**

Add these variables (do not commit this file):

```
DATABASE_URL=<your-neon-postgres-connection-string>
BETTER_AUTH_SECRET=<random-32+-character-string>
BETTER_AUTH_URL=http://localhost:3000
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

For production on Vercel, set the same variables in the Vercel dashboard, replacing the localhost URLs with your deployed domain.

Remove these old variables if present:
```
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_DB_URL
DIRECT_DATABASE_URL
```

- [ ] **Step 2: Run a full TypeScript check across all packages**

```bash
cd /home/andyr/IDentik/packages/database && npx tsc --noEmit
cd /home/andyr/IDentik/web && npx tsc --noEmit
```

Expected: zero errors in both.

- [ ] **Step 3: Run a Next.js production build**

```bash
cd /home/andyr/IDentik/web && npm run build
```

Expected: build completes with no errors. All pages compile.

- [ ] **Step 4: Smoke test locally**

```bash
cd /home/andyr/IDentik/web && npm run dev
```

1. Open `http://localhost:3000`
2. Click "Create account" — sign up with a test email/password
3. Sign in with those credentials — session appears, "You are signed in" shows
4. Claim an Identik Name
5. Protect a photo — download should succeed
6. Verify the protected photo — should return a score

- [ ] **Step 5: Final commit**

```bash
cd /home/andyr/IDentik
git add web/.env.local.example  # if you add a template file
git commit -m "chore: Neon + Better Auth migration complete"
```
