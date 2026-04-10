# Perceptual Hash (pHash) Matching for Screenshot Verification

**Date:** 2026-04-10  
**Status:** Approved  
**Scope:** Images only (video key-frame hashing planned as future work)

## Problem

The current verify route requires embedded `IdentikStamp` metadata and an exact SHA256 file match. Screenshots — taken from Instagram, social media, or any re-compressed copy — strip embedded metadata and change pixel data, causing the route to return "Not protected" even when the image content is authentic. End users who don't have the original file cannot verify media they encounter in the wild.

## Solution

Add dHash (difference hash) perceptual matching as a secondary verify path. When a submitted image has no embedded Identik metadata, compute its 64-bit dHash and query the database for visually similar signed records within a Hamming distance threshold. Return a tiered "Possible match" response — never `verified: true` — that surfaces the original signer's Identik Name without affecting their reputation score.

## Algorithm — dHash

1. Resize image to 9×8 grayscale via Sharp (already in stack, zero new dependencies)
2. For each row, compare adjacent pixel brightness: `pixel[x] > pixel[x+1]` → bit = 1
3. Pack 64 bits into a `BigInt`
4. Store as `bigint` in the database

dHash was chosen over DCT-based pHash (more complex, requires manual DCT implementation) and multi-hash (future Option C upgrade path). dHash handles JPEG compression, Instagram-style downscaling, and screenshot capture well. It is not rotation-resistant, which is acceptable since screenshots are not typically rotated.

## Architecture

Two verify paths remain cleanly separate:

```
Verify upload received
├── Has embedded IdentikStamp?
│   └── YES → existing flow (unchanged)
│
└── NO
    └── Is it an image?
        ├── NO → "Not protected" (unchanged)
        └── YES → compute dHash → query mediaRecords within 35-bit threshold
            ├── No matches → "Not protected"
            └── Match(es) found → tiered "Possible match" response
```

pHash is never computed at verify time for files that already have embedded metadata. The existing verify flow is untouched.

## Database

One new nullable column on `media_records`:

```sql
ALTER TABLE media_records ADD COLUMN p_hash bigint;
```

- `bigint` stores the 64-bit dHash as a signed integer — no PostgreSQL extension required
- Nullable: existing records lack it, videos are skipped
- Hamming distance via built-in PostgreSQL operators:

```sql
SELECT id, domain_id, bit_count(p_hash # $1::bigint) AS distance
FROM media_records
WHERE p_hash IS NOT NULL
  AND bit_count(p_hash # $1::bigint) <= 35
ORDER BY distance ASC
LIMIT 10;
```

`#` is XOR in PostgreSQL; `bit_count` counts set bits. O(n) scan is acceptable at launch scale. A future multi-hash bucketing strategy (Option C) can add index support without changing the column schema.

Drizzle schema addition to `mediaRecords`:

```ts
pHash: bigint('p_hash', { mode: 'bigint' }).default(null)
```

## Sign Route Changes

A new `pHashUtils.ts` module in `web/src/server/` exposes `computeDHash(buffer: Buffer): Promise<bigint>`.

In the sign route, after `workingBuffer` is finalized (post-watermark):

```ts
const pHash = isPhoto ? await computeDHash(workingBuffer) : null;
```

Passed into the `mediaRecords` insert alongside existing fields. If `computeDHash` throws, it logs a warning and falls back to `null` — signing never fails because of pHash. pHash is computed on `workingBuffer` (post-watermark) so watermarked signed images and their screenshots produce matching hashes.

## Verify Route Changes

After `extractIdentikMetadata` returns `null`, the verify route detects the MIME type using `fileTypeFromBuffer` (already available in the codebase via the `file-type` package) to determine whether the upload is an image before attempting pHash lookup:

```ts
const fileTypeInfo = await fileTypeFromBuffer(buffer);
const isImage = fileTypeInfo?.mime?.startsWith('image/') ?? false;
const pHashResult = isImage ? await findPHashMatches(buffer) : null;
```

`findPHashMatches` returns the best match (lowest Hamming distance) and total count of matches within threshold.

### Confidence Tiers

| Hamming Distance | Tier | Message | Score |
|---|---|---|---|
| ≤ 10 | High confidence | "Likely a copy of media protected by [Name]" | 0.45 |
| 11–20 | Probable | "Probable visual match to media protected by [Name]" | 0.30 |
| 21–35 | Weak | "Weak visual similarity to media protected by [Name]" | 0.15 |
| > 35 | No match | "Not protected" | 0 |

### Response Shape

pHash match responses use `verified: false` always and include a `match_type: 'perceptual'` field to allow clients to distinguish from standard verification:

```json
{
  "verified": false,
  "match_type": "perceptual",
  "confidence": "high",
  "score": 0.45,
  "identik_name": "kim.k",
  "label": "Possible match",
  "message": "Likely a copy of media protected by kim.k",
  "details": {
    "hamming_distance": 7,
    "other_matches": 2
  }
}
```

Best match is shown prominently. When `other_matches > 0`, the count is surfaced so users know additional candidates exist.

## Reputation & Reporting

- **pHash-only verify:** No `domainEvent` is written for the original signer. Attribution is surfaced to the user but does not affect reputation.
- **User reports a pHash-matched image** (e.g. claiming it was reposted without consent or manipulated): `domainEvent` weight of `-0.15` (vs `-0.5` for a report on a direct verify match). This is a reduced signal — the signer is not responsible for another user reposting their content, but repeated patterns still accrue.

## New Files

- `web/src/server/pHashUtils.ts` — `computeDHash(buffer)` and `findPHashMatches(buffer)`

## Changed Files

- `packages/database/src/schema.ts` — add `pHash` column to `mediaRecords`
- `packages/database/migrations/` — migration adding `p_hash bigint` column
- `web/src/app/api/v1/sign/route.ts` — compute and store pHash for photos
- `web/src/app/api/v1/verify/route.ts` — pHash fallback branch when no embedded metadata

## Future Work

- **Video key-frame hashing:** Sample key frames via ffmpeg (already in stack via ffprobe), compute dHash per frame, store frame-level hashes in a separate table, match against submitted video screenshots
- **Multi-hash (Option C):** Add average hash (`aHash`) alongside dHash for improved color-shift resilience; store both columns, combine scores at match time
- **Bucketed index:** Divide 64-bit hash into segments for approximate nearest-neighbour index when table size makes O(n) scans too slow
