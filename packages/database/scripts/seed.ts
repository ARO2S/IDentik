import { closeDbPool, withDb, schema } from '../src/index.js';
import { eq } from 'drizzle-orm';
import { fingerprintPublicKey, generateKeypair } from '@identik/crypto-utils';

const DEMO_EMAIL = process.env.SEED_DEMO_EMAIL ?? 'demo@identik.dev';
const DEMO_IDENTIK_NAME = process.env.SEED_DEMO_IDENTIK_NAME ?? 'demo.identik';

async function seed() {

  await withDb(async (db) => {
    const authUser = await db.query.user.findFirst({
      where: eq(schema.user.email, DEMO_EMAIL)
    });

    if (!authUser) {
      throw new Error(
        `No user found with email "${DEMO_EMAIL}". Sign up via the web UI first, then run the seed.`
      );
    }

    const { privateKeyHex: _privateKeyHex, publicKeyHex: seedPublicKey } = await generateKeypair();
    const keyFingerprint = fingerprintPublicKey(seedPublicKey);

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
            publicKey: seedPublicKey,
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
