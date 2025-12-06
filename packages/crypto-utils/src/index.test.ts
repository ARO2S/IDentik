import { describe, expect, it } from 'vitest';
import {
  IDENTIK_PAYLOAD_VERSION,
  canonicalPayloadHash,
  createCanonicalPayload,
  derivePublicKey,
  fingerprintPayload,
  fingerprintPublicKey,
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
});
