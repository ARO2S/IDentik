import { describe, expect, it } from 'vitest';
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

const PRIVATE_KEY_HEX = '4c3a1d5ac2f8c4a1f3d9b2a6ccd5e2f14c3a1d5ac2f8c4a1f3d9b2a6ccd5e2f1';

describe('canonical payload helpers', () => {
  it('keeps metadata order stable regardless of insertion order', () => {
    const payloadA = createCanonicalPayload({
      identikName: 'Jenny.IDENTIK',
      fileSha256: 'abc123',
      metadata: { b: 2, a: 1 },
      timestamp: '2025-12-02T15:00:00.000Z'
    });

    const payloadB = createCanonicalPayload({
      identikName: 'jenny.identik',
      fileSha256: 'abc123',
      metadata: { a: 1, b: 2 },
      timestamp: '2025-12-02T15:00:00.000Z'
    });

    expect(payloadA.version).toBe(IDENTIK_PAYLOAD_VERSION);
    expect(serializeCanonicalPayload(payloadA)).toEqual(serializeCanonicalPayload(payloadB));
    expect(fingerprintPayload(payloadA)).toEqual(fingerprintPayload(payloadB));
  });

  it('signs and verifies payload hashes', async () => {
    const payload = createCanonicalPayload({
      identikName: 'photo.identik',
      fileSha256: 'deadbeef',
      metadata: { caption: 'Family photo', location: 'Seattle' },
      timestamp: '2025-12-02T15:00:00.000Z'
    });

    const payloadHash = canonicalPayloadHash(payload);
    const publicKeyHex = await derivePublicKey(PRIVATE_KEY_HEX);
    const signature = await signPayload(payloadHash, PRIVATE_KEY_HEX);

    await expect(verifyPayload(payloadHash, signature, publicKeyHex)).resolves.toBe(true);
    expect(fingerprintPublicKey(publicKeyHex)).toBeTypeOf('string');
  });

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
});
