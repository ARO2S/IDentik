# Per-Domain Server-Held Signing Keys Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single global `DEV_SIGNING_PRIVATE_KEY` with automatically provisioned, per-domain Ed25519 keypairs stored encrypted in the database.

**Architecture:** Each Identik Name (domain) gets its own Ed25519 keypair generated on first sign. The private key is AES-256-GCM encrypted at rest using a server secret and stored alongside the public key in `domain_public_keys`. The sign route calls a `getOrCreateDomainKey` helper that handles lazy provisioning. The verify route is unchanged — it already looks up keys by fingerprint. Existing signatures remain valid.

**Tech Stack:** Node.js `crypto` (AES-256-GCM), `@noble/ed25519` (already in use), Drizzle ORM migrations, Vitest (tests in `crypto-utils`)

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `packages/crypto-utils/src/index.ts` | Add `generateKeypair()` export |
| Modify | `packages/crypto-utils/src/index.test.ts` | Test `generateKeypair()` |
| Modify | `packages/database/src/schema.ts` | Add `keySource` + `encryptedPrivateKey` columns |
| Generate + apply | `packages/database/migrations/` | Drizzle migration for new columns |
| Create | `web/src/server/keyEncryption.ts` | AES-256-GCM encrypt/decrypt for private keys |
| Create | `web/src/server/domainKeys.ts` | `getOrCreateDomainKey()` — provisioning logic |
| Modify | `web/src/app/api/v1/sign/route.ts` | Use `getOrCreateDomainKey`, remove env-var keys |
| Modify | `packages/database/scripts/seed.ts` | Generate per-domain key instead of using env var |
| Modify | `web/.env.local` | Add `SIGNING_KEY_ENCRYPTION_SECRET`, remove dev key vars |

---

## Task 1: Add `generateKeypair` to crypto-utils

**Files:**
- Modify: `packages/crypto-utils/src/index.ts`
- Modify: `packages/crypto-utils/src/index.test.ts`

- [ ] **Step 1: Write the failing test**

Add this test to `packages/crypto-utils/src/index.test.ts` inside the `describe` block after the existing tests:

```typescript
it('generates a valid Ed25519 keypair', async () => {
  const { privateKeyHex, publicKeyHex } = await generateKeypair();

  expect(privateKeyHex).toHaveLength(64); // 32 bytes → 64 hex chars
  expect(publicKeyHex).toHaveLength(64);

  // The derived public key must match
  const derived = await derivePublicKey(privateKeyHex);
  expect(derived).toBe(publicKeyHex);

  // The keypair must produce verifiable signatures
  const payload = createCanonicalPayload({
    identikName: 'test.identik',
    fileSha256: 'abc',
    timestamp: '2026-01-01T00:00:00.000Z'
  });
  const hash = canonicalPayloadHash(payload);
  const sig = await signPayload(hash, privateKeyHex);
  await expect(verifyPayload(hash, sig, publicKeyHex)).resolves.toBe(true);
});
```

Also add `generateKeypair` to the import line at the top of the test file:
```typescript
import {
  IDENTIK_PAYLOAD_VERSION,
  canonicalPayloadHash,
  createCanonicalPayload,
  derivePublicKey,
  fingerprintPayload,
  fingerprintPublicKey,
  generateKeypair,
  serializeCanonicalPayload,
  signPayload,
  verifyPayload
} from './index.js';
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd packages/crypto-utils && npm test
```

Expected: FAIL — `generateKeypair` is not exported from `./index.js`

- [ ] **Step 3: Add `generateKeypair` to `packages/crypto-utils/src/index.ts`**

Add this function after `derivePublicKey` (around line 132):

```typescript
export const generateKeypair = async (): Promise<{ privateKeyHex: string; publicKeyHex: string }> => {
  const privateKeyBytes = etc.randomBytes(32);
  const publicKeyBytes = await getPublicKey(privateKeyBytes);
  return {
    privateKeyHex: bytesToHex(privateKeyBytes),
    publicKeyHex: bytesToHex(publicKeyBytes)
  };
};
```

`etc` and `getPublicKey` are already imported at line 1. `bytesToHex` is already imported from `@noble/hashes/utils.js`.

- [ ] **Step 4: Run tests to confirm pass**

```bash
cd packages/crypto-utils && npm test
```

Expected: PASS — all 3 tests green

- [ ] **Step 5: Commit**

```bash
git add packages/crypto-utils/src/index.ts packages/crypto-utils/src/index.test.ts
git commit -m "feat(crypto-utils): add generateKeypair for per-domain key provisioning"
```

---

## Task 2: Schema — add `keySource` and `encryptedPrivateKey` to `domainPublicKeys`

**Files:**
- Modify: `packages/database/src/schema.ts`
- Generate + apply: `packages/database/migrations/`

- [ ] **Step 1: Update the schema**

In `packages/database/src/schema.ts`, replace the `domainPublicKeys` table definition (lines 90–99) with:

```typescript
export const domainPublicKeys = pgTable('domain_public_keys', {
  id: uuid('id').defaultRandom().primaryKey(),
  domainId: uuid('domain_id').references(() => domains.id),
  keyType: text('key_type').notNull(),
  publicKey: text('public_key').notNull(),
  keyFingerprint: text('key_fingerprint').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  revoked: boolean('revoked').default(false),
  keySource: text('key_source').notNull().default('server_generated'),
  encryptedPrivateKey: text('encrypted_private_key'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default(sql`'{}'::jsonb`)
});
```

Also add this export near the bottom of the file in the Types section (after line 206):

```typescript
export type InsertDomainPublicKey = typeof domainPublicKeys.$inferInsert;
```

- [ ] **Step 2: Generate the migration**

```bash
cd packages/database && npm run generate
```

Expected output: something like `Generated 1 migration file in ./migrations/`. A new file `migrations/0003_*.sql` will be created.

- [ ] **Step 3: Apply the migration**

```bash
cd packages/database && npm run db:migrate
```

Expected: `Migration applied successfully` (or similar). Confirm no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/database/src/schema.ts packages/database/migrations/
git commit -m "feat(db): add keySource and encryptedPrivateKey columns to domain_public_keys"
```

---

## Task 3: Create key encryption utility

**Files:**
- Create: `web/src/server/keyEncryption.ts`

This module wraps Node's built-in AES-256-GCM so private keys are never stored in plaintext. The format is: `iv (12 bytes) + auth tag (16 bytes) + ciphertext`, all hex-encoded as a single string.

- [ ] **Step 1: Create `web/src/server/keyEncryption.ts`**

```typescript
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

function getEncryptionKey(): Buffer {
  const secret = process.env.SIGNING_KEY_ENCRYPTION_SECRET;
  if (!secret) {
    throw new Error('SIGNING_KEY_ENCRYPTION_SECRET is not set.');
  }
  const key = Buffer.from(secret, 'hex');
  if (key.length !== KEY_BYTES) {
    throw new Error(
      'SIGNING_KEY_ENCRYPTION_SECRET must be exactly 32 bytes (64 hex characters).'
    );
  }
  return key;
}

/**
 * Encrypts a private key hex string.
 * Returns: hex-encoded iv (12 bytes) + auth tag (16 bytes) + ciphertext.
 */
export function encryptPrivateKey(privateKeyHex: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const plaintext = Buffer.from(privateKeyHex, 'utf8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('hex');
}

/**
 * Decrypts an encrypted private key produced by encryptPrivateKey.
 * Returns the original private key hex string.
 */
export function decryptPrivateKey(encryptedHex: string): string {
  const key = getEncryptionKey();
  const data = Buffer.from(encryptedHex, 'hex');
  const iv = data.subarray(0, IV_BYTES);
  const tag = data.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = data.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
```

- [ ] **Step 2: Add `SIGNING_KEY_ENCRYPTION_SECRET` to `web/.env.local`**

Generate a 32-byte random hex secret:
```bash
openssl rand -hex 32
```

Copy the output, then add this line to `web/.env.local`:
```
SIGNING_KEY_ENCRYPTION_SECRET=<paste_output_here>
```

- [ ] **Step 3: Commit**

```bash
git add web/src/server/keyEncryption.ts web/.env.local
git commit -m "feat(web): add AES-256-GCM key encryption utility for private key at-rest storage"
```

---

## Task 4: Create `getOrCreateDomainKey` helper

**Files:**
- Create: `web/src/server/domainKeys.ts`

This is the core provisioning logic. On every sign request it either retrieves the existing domain keypair or generates a fresh one.

- [ ] **Step 1: Create `web/src/server/domainKeys.ts`**

```typescript
import { db } from '@/server/db';
import { decryptPrivateKey, encryptPrivateKey } from '@/server/keyEncryption';
import { fingerprintPublicKey, generateKeypair } from '@identik/crypto-utils';
import { schema } from '@identik/database';
import { and, eq, isNotNull } from 'drizzle-orm';

export interface DomainKeyResult {
  domainKeyId: string;
  privateKeyHex: string;
  publicKeyHex: string;
  keyFingerprint: string;
}

/**
 * Returns the active signing keypair for a domain, creating one if none exists.
 * "Active" means: not revoked, and has an encrypted private key stored
 * (rows without encryptedPrivateKey are legacy global-key registrations).
 */
export async function getOrCreateDomainKey(domainId: string): Promise<DomainKeyResult> {
  const existing = await db.query.domainPublicKeys.findFirst({
    where: and(
      eq(schema.domainPublicKeys.domainId, domainId),
      eq(schema.domainPublicKeys.revoked, false),
      isNotNull(schema.domainPublicKeys.encryptedPrivateKey)
    )
  });

  if (existing?.encryptedPrivateKey) {
    return {
      domainKeyId: existing.id,
      privateKeyHex: decryptPrivateKey(existing.encryptedPrivateKey),
      publicKeyHex: existing.publicKey,
      keyFingerprint: existing.keyFingerprint
    };
  }

  // No usable key found — generate a fresh per-domain keypair.
  const { privateKeyHex, publicKeyHex } = await generateKeypair();
  const keyFingerprint = fingerprintPublicKey(publicKeyHex);
  const encryptedPrivateKey = encryptPrivateKey(privateKeyHex);

  try {
    const [newKey] = await db
      .insert(schema.domainPublicKeys)
      .values({
        domainId,
        keyType: 'ed25519',
        publicKey: publicKeyHex,
        keyFingerprint,
        encryptedPrivateKey,
        keySource: 'server_generated',
        metadata: {}
      })
      .returning();

    return {
      domainKeyId: newKey.id,
      privateKeyHex,
      publicKeyHex,
      keyFingerprint
    };
  } catch {
    // Race condition: another request inserted a key between our SELECT and INSERT.
    // Fall back to whatever is now in the database.
    const fallback = await db.query.domainPublicKeys.findFirst({
      where: and(
        eq(schema.domainPublicKeys.domainId, domainId),
        eq(schema.domainPublicKeys.revoked, false),
        isNotNull(schema.domainPublicKeys.encryptedPrivateKey)
      )
    });

    if (!fallback?.encryptedPrivateKey) {
      throw new Error(`Could not provision or retrieve signing key for domain ${domainId}`);
    }

    return {
      domainKeyId: fallback.id,
      privateKeyHex: decryptPrivateKey(fallback.encryptedPrivateKey),
      publicKeyHex: fallback.publicKey,
      keyFingerprint: fallback.keyFingerprint
    };
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/server/domainKeys.ts
git commit -m "feat(web): add getOrCreateDomainKey for lazy per-domain keypair provisioning"
```

---

## Task 5: Refactor sign route to use per-domain keys

**Files:**
- Modify: `web/src/app/api/v1/sign/route.ts`

The sign route currently reads `DEV_SIGNING_PRIVATE_KEY` / `DEV_SIGNING_PUBLIC_KEY` from env and does manual key registration. Replace all of that with a call to `getOrCreateDomainKey`.

- [ ] **Step 1: Add import and remove env-var key block**

At the top of `web/src/app/api/v1/sign/route.ts`, add this import alongside the other server imports:

```typescript
import { getOrCreateDomainKey } from '@/server/domainKeys';
```

Remove this entire block (lines 129–134):

```typescript
  const privateKeyHex = process.env.DEV_SIGNING_PRIVATE_KEY;
  const publicKeyHex = process.env.DEV_SIGNING_PUBLIC_KEY;

  if (!privateKeyHex || !publicKeyHex) {
    return serverError('Signing keys are not configured.');
  }
```

- [ ] **Step 2: Replace the manual domainKey provisioning block with a single call**

Remove lines 194–242 (the entire `let domainKey = ...` block through the `}` that closes the outer `if (!domainKey)` block):

```typescript
  let domainKey = await db.query.domainPublicKeys.findFirst({
    where: and(
      eq(schema.domainPublicKeys.keyFingerprint, keyFingerprint),
      eq(schema.domainPublicKeys.domainId, domain.id)
    )
  });

  if (!domainKey) {
    // ... all the way through ...
  }
```

Replace it with:

```typescript
  let domainKeyId: string;
  let privateKeyHex: string;
  let publicKeyHex: string;
  let keyFingerprint: string;

  try {
    ({ domainKeyId, privateKeyHex, publicKeyHex, keyFingerprint } =
      await getOrCreateDomainKey(domain.id));
  } catch (err) {
    console.error('[api/v1/sign] failed to provision domain key', err);
    return serverError('Could not provision a signing key for this Identik Name.');
  }
```

- [ ] **Step 3: Remove now-unused imports from the sign route**

Remove `and` from the drizzle-orm import since the key lookup block that used it is gone. The import line currently reads:

```typescript
import { and, eq } from 'drizzle-orm';
```

Change it to:

```typescript
import { eq } from 'drizzle-orm';
```

Also remove `fingerprintPublicKey` from the `@identik/crypto-utils` import since it is now called inside `domainKeys.ts`. The import currently reads:

```typescript
import {
  canonicalPayloadHash,
  createCanonicalPayload,
  fingerprintPublicKey,
  signPayload,
  sha256Hex
} from '@identik/crypto-utils';
```

Change it to:

```typescript
import {
  canonicalPayloadHash,
  createCanonicalPayload,
  signPayload,
  sha256Hex
} from '@identik/crypto-utils';
```

- [ ] **Step 4: Update the `db.insert(schema.signatures)` call**

The `domainPublicKeyId` field previously referenced `domainKey.id`. It now references `domainKeyId`. Find this block (around line 261):

```typescript
  await db.insert(schema.signatures).values({
    mediaId: media.id,
    domainPublicKeyId: domainKey.id,
    signature,
    algorithm: 'ed25519'
  });
```

Change `domainKey.id` to `domainKeyId`:

```typescript
  await db.insert(schema.signatures).values({
    mediaId: media.id,
    domainPublicKeyId: domainKeyId,
    signature,
    algorithm: 'ed25519'
  });
```

- [ ] **Step 5: Verify the build compiles**

```bash
cd web && npx tsc --noEmit
```

Expected: no type errors. If there are errors about `domainKey` still being referenced, search the file for remaining uses:

```bash
grep -n 'domainKey' web/src/app/api/v1/sign/route.ts
```

Only `domainKeyId` should remain.

- [ ] **Step 6: Commit**

```bash
git add web/src/app/api/v1/sign/route.ts
git commit -m "feat(web): use per-domain keypairs in sign route, remove global DEV_SIGNING_KEY dependency"
```

---

## Task 6: Update seed script

**Files:**
- Modify: `packages/database/scripts/seed.ts`

The seed script currently depends on `DEV_SIGNING_PUBLIC_KEY`. Update it to generate its own keypair for the demo domain.

- [ ] **Step 1: Update imports in `packages/database/scripts/seed.ts`**

Replace:
```typescript
import { fingerprintPublicKey } from '@identik/crypto-utils';
```

With:
```typescript
import { fingerprintPublicKey, generateKeypair } from '@identik/crypto-utils';
```

- [ ] **Step 2: Remove the `DEV_PUBLIC_KEY` variable and its guard**

Remove these lines (lines 7–13):
```typescript
const DEV_PUBLIC_KEY = process.env.DEV_SIGNING_PUBLIC_KEY;

async function seed() {
  if (!DEV_PUBLIC_KEY) {
    throw new Error('Set DEV_SIGNING_PUBLIC_KEY before running the seed script.');
  }
```

Replace with:
```typescript
async function seed() {
```

- [ ] **Step 3: Generate a keypair instead of reading from env**

Inside the `await withDb(async (db) => {` block, replace:
```typescript
    const keyFingerprint = fingerprintPublicKey(DEV_PUBLIC_KEY);
```

With:
```typescript
    const { privateKeyHex: _privateKeyHex, publicKeyHex: seedPublicKey } = await generateKeypair();
    const keyFingerprint = fingerprintPublicKey(seedPublicKey);
```

Note: `_privateKeyHex` is prefixed with `_` to signal it is intentionally unused in the seed — the seed doesn't store the private key since domain keys in production are provisioned at sign time by `getOrCreateDomainKey`.

- [ ] **Step 4: Update the `domainPublicKeys` insert to use `seedPublicKey`**

Find the insert block (around line 48):
```typescript
          .values({
            domainId: domain.id,
            keyType: 'ed25519',
            publicKey: DEV_PUBLIC_KEY,
            keyFingerprint,
            metadata: { seeded: true }
          })
```

Replace `publicKey: DEV_PUBLIC_KEY` with `publicKey: seedPublicKey`:
```typescript
          .values({
            domainId: domain.id,
            keyType: 'ed25519',
            publicKey: seedPublicKey,
            keyFingerprint,
            metadata: { seeded: true }
          })
```

- [ ] **Step 5: Commit**

```bash
git add packages/database/scripts/seed.ts
git commit -m "chore(seed): generate per-domain keypair instead of reading global DEV_SIGNING_KEY"
```

---

## Task 7: Clean up env vars

**Files:**
- Modify: `web/.env.local`

- [ ] **Step 1: Remove the now-unused dev key vars from `web/.env.local`**

Remove these two lines from `web/.env.local`:
```
DEV_SIGNING_PRIVATE_KEY=...
DEV_SIGNING_PUBLIC_KEY=...
```

The `SIGNING_KEY_ENCRYPTION_SECRET` added in Task 3 is the only signing-related env var needed going forward.

- [ ] **Step 2: Verify the app still starts**

```bash
cd web && npm run dev
```

Expected: starts without errors on `http://localhost:3000`. Confirm no `DEV_SIGNING_KEY` related startup errors.

- [ ] **Step 3: Smoke test sign flow manually**

With the dev server running:
1. Log in and navigate to your Identik Name
2. Sign a test image
3. Confirm the response contains a valid `X-Identik-Summary` header with `signature` populated
4. Run verify on the returned file — confirm `verified: true`

- [ ] **Step 4: Commit**

```bash
git add web/.env.local
git commit -m "chore: remove global DEV_SIGNING_KEY env vars, SIGNING_KEY_ENCRYPTION_SECRET is now the only signing secret"
```

---

## Self-Review

**Spec coverage:**
- ✅ Per-domain keypairs: `getOrCreateDomainKey` provisions fresh Ed25519 keys per `domainId`
- ✅ Server-held private keys: stored AES-256-GCM encrypted in `encrypted_private_key`
- ✅ `key_source` field added for future passkey migration path
- ✅ Revocation is now isolated to a single domain (`getOrCreateDomainKey` filters `revoked = false`)
- ✅ Existing signatures remain valid — verify route unchanged, still lookups by `keyFingerprint`
- ✅ Legacy global-key rows unaffected — `encryptedPrivateKey IS NULL` rows are simply not selected for new sign operations
- ✅ Race condition handled in `getOrCreateDomainKey` fallback block

**Placeholder scan:** None found — all code blocks are complete and executable.

**Type consistency:**
- `DomainKeyResult` defined in `domainKeys.ts` and destructured by name in `sign/route.ts` — consistent
- `encryptedPrivateKey` and `keySource` column names match across schema, insert in `domainKeys.ts`, and seed script
- `domainKeyId` (not `domainKey.id`) used consistently throughout the sign route after refactor
