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
