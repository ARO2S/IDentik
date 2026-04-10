import sharp from 'sharp';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PHashTier = 'high' | 'probable' | 'weak';

export type PHashMatchResult = {
  mediaId: string;
  domainId: string;
  distance: number;
  tier: PHashTier;
  score: number;
  otherMatchCount: number;
};

// ---------------------------------------------------------------------------
// Tier thresholds and scoring
// ---------------------------------------------------------------------------

export const PHASH_MAX_DISTANCE = 35;

export const getTierForDistance = (distance: number): PHashTier | null => {
  if (distance <= 10) return 'high';
  if (distance <= 20) return 'probable';
  if (distance <= PHASH_MAX_DISTANCE) return 'weak';
  return null;
};

export const getScoreForTier = (tier: PHashTier): number => {
  if (tier === 'high') return 0.45;
  if (tier === 'probable') return 0.30;
  return 0.15;
};

export const getLabelForTier = (tier: PHashTier, identikName: string): string => {
  if (tier === 'high') return `Likely a copy of media protected by ${identikName}`;
  if (tier === 'probable') return `Probable visual match to media protected by ${identikName}`;
  return `Weak visual similarity to media protected by ${identikName}`;
};

// ---------------------------------------------------------------------------
// dHash computation
// ---------------------------------------------------------------------------

// Convert an unsigned 64-bit BigInt to a signed int64 value for PostgreSQL.
// PostgreSQL bigint is signed; dHash produces unsigned 64-bit values.
const toSignedBigInt64 = (n: bigint): bigint => {
  const bit63 = 1n << 63n;
  const bit64 = 1n << 64n;
  return n >= bit63 ? n - bit64 : n;
};

export const computeDHash = async (buffer: Buffer): Promise<bigint> => {
  // Resize to 9×8 grayscale. Each row of 9 pixels produces 8 comparison bits.
  const { data } = await sharp(buffer)
    .resize(9, 8, { fit: 'fill' })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let hash = 0n;
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const left = data[row * 9 + col];
      const right = data[row * 9 + col + 1];
      hash = (hash << 1n) | (left > right ? 1n : 0n);
    }
  }

  return toSignedBigInt64(hash & 0xFFFFFFFFFFFFFFFFn);
};

// ---------------------------------------------------------------------------
// DB lookup (implemented in Task 3)
// ---------------------------------------------------------------------------

export const findPHashMatches = async (_buffer: Buffer): Promise<PHashMatchResult | null> => {
  throw new Error('findPHashMatches: not yet implemented');
};
