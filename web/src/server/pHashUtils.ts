import sharp from 'sharp';
import { sql } from 'drizzle-orm';
import { db } from '@/server/db';

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

type RawMatchRow = {
  id: string;
  domain_id: string;
  distance: number;
};

export const findPHashMatches = async (buffer: Buffer): Promise<PHashMatchResult | null> => {
  let queryHash: bigint;
  try {
    queryHash = await computeDHash(buffer);
  } catch {
    return null;
  }

  // sql.raw is safe here: queryHash is a BigInt we computed internally,
  // never derived from user-supplied text.
  const hashLiteral = queryHash.toString();

  const rows = await db.execute<RawMatchRow>(sql`
    SELECT
      id,
      domain_id,
      bit_count(p_hash # ${sql.raw(hashLiteral)}::bigint)::integer AS distance
    FROM media_records
    WHERE p_hash IS NOT NULL
      AND bit_count(p_hash # ${sql.raw(hashLiteral)}::bigint) <= ${PHASH_MAX_DISTANCE}
    ORDER BY distance ASC
    LIMIT 10
  `);

  if (!rows.rows || rows.rows.length === 0) {
    return null;
  }

  const best = rows.rows[0];
  const tier = getTierForDistance(best.distance);

  if (!tier) {
    return null;
  }

  return {
    mediaId: best.id,
    domainId: best.domain_id,
    distance: best.distance,
    tier,
    score: getScoreForTier(tier),
    otherMatchCount: rows.rows.length - 1
  };
};
