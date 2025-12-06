import { closeDbPool, withDb, schema, createServiceSupabaseClient } from '../src/index.js';
import { eq } from 'drizzle-orm';
import { fingerprintPublicKey } from '@identik/crypto-utils';

const DEMO_EMAIL = process.env.SEED_DEMO_EMAIL ?? 'demo@identik.dev';
const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'identik-demo';
const DEMO_IDENTIK_NAME = process.env.SEED_DEMO_IDENTIK_NAME ?? 'demo.identik';
const DEV_PUBLIC_KEY = process.env.DEV_SIGNING_PUBLIC_KEY;

async function ensureAuthUser() {
  const supabaseAdmin = createServiceSupabaseClient();
  const existingUsers = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const matched = existingUsers.data.users.find((user) => user.email?.toLowerCase() === DEMO_EMAIL.toLowerCase());
  if (matched) {
    return matched;
  }
  const created = await supabaseAdmin.auth.admin.createUser({
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
    email_confirm: true
  });
  if (!created.data.user) {
    throw created.error ?? new Error('Unable to create demo Supabase user');
  }
  return created.data.user;
}

async function seed() {
  if (!DEV_PUBLIC_KEY) {
    throw new Error('Set DEV_SIGNING_PUBLIC_KEY before running the seed script.');
  }

  const authUser = await ensureAuthUser();
  const keyFingerprint = fingerprintPublicKey(DEV_PUBLIC_KEY);

  await withDb(async (db) => {
    const existingUser = await db.query.users.findFirst({ where: eq(schema.users.id, authUser.id) });
    const user =
      existingUser ??
      (await db
        .insert(schema.users)
        .values({ id: authUser.id, email: DEMO_EMAIL, displayName: 'Demo Identik' })
        .returning())[0];

    const existingDomain = await db.query.domains.findFirst({ where: eq(schema.domains.name, DEMO_IDENTIK_NAME) });
    const domain =
      existingDomain ??
      (await db
        .insert(schema.domains)
        .values({ name: DEMO_IDENTIK_NAME, ownerUserId: user.id, status: 'active' })
        .returning())[0];

    const existingKey = await db.query.domainPublicKeys.findFirst({ where: eq(schema.domainPublicKeys.keyFingerprint, keyFingerprint) });
    const domainKey =
      existingKey ??
      (await db
        .insert(schema.domainPublicKeys)
        .values({
          domainId: domain.id,
          keyType: 'ed25519',
          publicKey: DEV_PUBLIC_KEY,
          keyFingerprint,
          metadata: { seeded: true }
        })
        .returning())[0];

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
      {
        domainId: domain.id,
        eventType: 'media_signed',
        weight: 1,
        metadata: { seeded: true }
      },
      {
        domainId: domain.id,
        eventType: 'verification_pass',
        weight: 0.5,
        metadata: { seeded: true }
      }
    ]);

    await db
      .insert(schema.verificationLogs)
      .values({
        mediaId: media?.id ?? null,
        verified: true,
        score: 0.9,
        report: { seeded: true },
        createdAt: new Date()
      })
      .onConflictDoNothing();

    console.info(`Seeded demo user (${DEMO_EMAIL}) and Identik Name (${DEMO_IDENTIK_NAME}).`);
  });

  await closeDbPool();
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
