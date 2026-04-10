import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import {
  computeDHash,
  getTierForDistance,
  getScoreForTier,
  getLabelForTier,
  PHASH_MAX_DISTANCE
} from './pHashUtils.js';

// Helper: create a solid-color JPEG buffer using Sharp
const solidBuffer = async (r: number, g: number, b: number): Promise<Buffer> =>
  sharp({ create: { width: 200, height: 200, channels: 3, background: { r, g, b } } })
    .jpeg({ quality: 90 })
    .toBuffer();

// Helper: compute Hamming distance between two bigints
const hammingDistance = (a: bigint, b: bigint): number => {
  let xor = a ^ b;
  // Handle negative (signed) bigints by masking to 64 bits unsigned
  xor = xor & 0xFFFFFFFFFFFFFFFFn;
  let count = 0;
  while (xor > 0n) {
    count += Number(xor & 1n);
    xor >>= 1n;
  }
  return count;
};

describe('computeDHash', () => {
  it('returns a bigint', async () => {
    const buf = await solidBuffer(255, 0, 0);
    const hash = await computeDHash(buf);
    expect(typeof hash).toBe('bigint');
  });

  it('returns 0 distance for identical images', async () => {
    const buf = await solidBuffer(100, 150, 200);
    const hashA = await computeDHash(buf);
    const hashB = await computeDHash(buf);
    expect(hashA).toBe(hashB);
    expect(hammingDistance(hashA, hashB)).toBe(0);
  });

  it('returns small distance for JPEG-recompressed copy of same image', async () => {
    const original = await solidBuffer(80, 120, 160);
    // Re-encode at lower quality to simulate social media compression
    const recompressed = await sharp(original).jpeg({ quality: 40 }).toBuffer();
    const hashOriginal = await computeDHash(original);
    const hashRecompressed = await computeDHash(recompressed);
    expect(hammingDistance(hashOriginal, hashRecompressed)).toBeLessThanOrEqual(10);
  });

  it('returns large distance for completely different images', async () => {
    // Use opposite horizontal gradients so dHash (gradient-based) produces very different hashes.
    // Left-bright-to-right-dark vs left-dark-to-right-bright.
    const pixels = 200 * 200 * 3;
    const lightToDark = Buffer.from(
      Array.from({ length: pixels }, (_, i) => {
        const x = Math.floor(i / 3) % 200;
        return Math.floor(255 * (1 - x / 199));
      })
    );
    const darkToLight = Buffer.from(
      Array.from({ length: pixels }, (_, i) => {
        const x = Math.floor(i / 3) % 200;
        return Math.floor(255 * (x / 199));
      })
    );
    const gradA = await sharp(lightToDark, { raw: { width: 200, height: 200, channels: 3 } })
      .jpeg({ quality: 90 })
      .toBuffer();
    const gradB = await sharp(darkToLight, { raw: { width: 200, height: 200, channels: 3 } })
      .jpeg({ quality: 90 })
      .toBuffer();
    const hashA = await computeDHash(gradA);
    const hashB = await computeDHash(gradB);
    expect(hammingDistance(hashA, hashB)).toBeGreaterThanOrEqual(20);
  });

  it('returns value within signed int64 range (PostgreSQL compatible)', async () => {
    const buf = await solidBuffer(255, 255, 0);
    const hash = await computeDHash(buf);
    expect(hash).toBeGreaterThanOrEqual(-(1n << 63n));
    expect(hash).toBeLessThanOrEqual((1n << 63n) - 1n);
  });
});

describe('getTierForDistance', () => {
  it('returns high for distance <= 10', () => {
    expect(getTierForDistance(0)).toBe('high');
    expect(getTierForDistance(10)).toBe('high');
  });

  it('returns probable for distance 11-20', () => {
    expect(getTierForDistance(11)).toBe('probable');
    expect(getTierForDistance(20)).toBe('probable');
  });

  it('returns weak for distance 21-35', () => {
    expect(getTierForDistance(21)).toBe('weak');
    expect(getTierForDistance(PHASH_MAX_DISTANCE)).toBe('weak');
  });

  it('returns null for distance > 35', () => {
    expect(getTierForDistance(36)).toBeNull();
    expect(getTierForDistance(64)).toBeNull();
  });
});

describe('getScoreForTier', () => {
  it('returns correct scores for each tier', () => {
    expect(getScoreForTier('high')).toBe(0.45);
    expect(getScoreForTier('probable')).toBe(0.30);
    expect(getScoreForTier('weak')).toBe(0.15);
  });
});

describe('getLabelForTier', () => {
  it('includes the identik name in all labels', () => {
    expect(getLabelForTier('high', 'kim.k')).toContain('kim.k');
    expect(getLabelForTier('probable', 'kim.k')).toContain('kim.k');
    expect(getLabelForTier('weak', 'kim.k')).toContain('kim.k');
  });
});
