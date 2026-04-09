import { db } from '@/server/db';
import { getAuthenticatedUser } from '@/server/auth';
import { getOrCreateDomainKey } from '@/server/domainKeys';
import { badRequest, forbidden, serverError, unauthorized } from '@/server/http';
import { normalizeIdentikName, parseLabelFromName } from '@/server/names';
import {
  appendSuffixToFileName,
  fileToBuffer,
  getSafeFileName,
  probeVideoDurationSeconds,
  sha256StreamHex
} from '@/server/files';
import {
  embedIdentikMetadata,
  type EmbedResult,
  type IdentikEmbeddedMetadata,
  type IdentikStamp
} from '@/server/metadata';
import { extractDeviceMetadata } from '@/server/deviceMetadata';
import { applyIdentikWatermark } from '@/server/watermark';
import {
  canonicalPayloadHash,
  createCanonicalPayload,
  signPayload,
  sha256Hex
} from '@identik/crypto-utils';
import { schema } from '@identik/database';
import { updateDomainReputation } from '@identik/reputation';
import { fileTypeFromBuffer } from 'file-type';
import { eq } from 'drizzle-orm';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { performance } from 'node:perf_hooks';

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'video/x-msvideo'
]);

export const runtime = 'nodejs';

const SIGN_DEBUG_ENABLED = process.env.SIGN_DEBUG === 'true';
const EMBED_TIMEOUT_MS = (() => {
  const parsed = Number(process.env.SIGN_EMBED_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30_000;
})();
const EMBED_TIMEOUT_ERROR_NAME = 'IdentikEmbedTimeoutError';
const VIDEO_MAX_BYTES = (() => {
  const parsed = Number(process.env.VIDEO_MAX_BYTES);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 800_000_000; // ~800 MB default cap
})();
const VIDEO_MAX_DURATION_SEC = (() => {
  const parsed = Number(process.env.VIDEO_MAX_DURATION_SEC);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 900; // 15 minutes default
})();

const logSignDebug = (...args: unknown[]) => {
  if (SIGN_DEBUG_ENABLED) {
    console.info('[api/v1/sign]', ...args);
  }
};

const withTimeout = <T>(promise: Promise<T>, timeoutMs: number, onTimeout: () => Error): Promise<T> => {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(onTimeout());
    }, timeoutMs);

    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
};

export async function POST(request: NextRequest) {
  const requestStart = performance.now();
  const user = await getAuthenticatedUser(request);
  if (!user) {
    return unauthorized();
  }

  const formData = await request.formData();
  const file = formData.get('file');
  const identikNameInput = formData.get('identikName');
  const watermarkPreference = formData.get('watermark');

  if (!(file instanceof File)) {
    return badRequest('Please attach the photo or video you want to protect.');
  }

  if (typeof identikNameInput !== 'string' || !identikNameInput.trim()) {
    return badRequest('Please choose the Identik Name to protect this photo or video under.');
  }

  if (file.size > VIDEO_MAX_BYTES) {
    const mb = Math.round(VIDEO_MAX_BYTES / 1_000_000);
    return badRequest(`This file is too large to protect right now. Please keep videos under ~${mb} MB.`);
  }

  const identikName = normalizeIdentikName(parseLabelFromName(identikNameInput));
  logSignDebug('request_received', { userId: user.id, identikName });

  const domain = await db.query.domains.findFirst({
    where: eq(schema.domains.name, identikName)
  });

  if (!domain) {
    return badRequest('We could not find that Identik Name.');
  }

  if (domain.ownerUserId !== user.id) {
    return forbidden('Only the owner of this Identik Name can protect media with it.');
  }

  const originalBuffer = await fileToBuffer(file);
  const fileTypeInfo = await fileTypeFromBuffer(originalBuffer);
  const detectedMime = fileTypeInfo?.mime ?? null;
  // Only trust server-detected MIME; never use the browser-supplied file.type
  // for the response header or logic decisions.
  const mimeType = detectedMime ?? 'application/octet-stream';
  const isPhoto = mimeType.startsWith('image/');
  const isVideo = mimeType.startsWith('video/');

  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    return badRequest(
      'Only photos and videos can be protected. Please upload a JPEG, PNG, WebP, GIF, HEIC, MP4, MOV, or WebM file.'
    );
  }
  const shouldWatermark =
    isPhoto && typeof watermarkPreference === 'string'
      ? ['true', '1', 'yes', 'on'].includes(watermarkPreference.toLowerCase())
      : false;

  const deviceMetadata = isPhoto ? extractDeviceMetadata(originalBuffer) : null;

  if (isVideo) {
    const durationSeconds = await probeVideoDurationSeconds(file);
    if (durationSeconds && durationSeconds > VIDEO_MAX_DURATION_SEC) {
      return badRequest(
        `This video is too long to protect right now. Please keep videos under ${VIDEO_MAX_DURATION_SEC} seconds.`
      );
    }
  }
  const workingBuffer = shouldWatermark ? await applyIdentikWatermark(originalBuffer) : originalBuffer;
  const fileSha256 = isVideo ? await sha256StreamHex(file) : sha256Hex(workingBuffer);
  const safeFileName = getSafeFileName(file, fileTypeInfo?.ext ?? (isVideo ? 'mp4' : 'jpg'));
  const signedFileName = appendSuffixToFileName(safeFileName, shouldWatermark ? '-identik-wm' : '-identik');

  const canonicalPayload = createCanonicalPayload({
    identikName,
    fileSha256,
    metadata: {
      mimeType,
      mediaType: isVideo ? 'video' : 'photo',
      originalName: safeFileName,
      size: workingBuffer.length,
      ...(deviceMetadata ? { deviceMetadata } : {})
    },
    timestamp: new Date().toISOString()
  });

  const payloadHash = canonicalPayloadHash(canonicalPayload);

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

  const signature = await signPayload(payloadHash, privateKeyHex);
  logSignDebug('file_ready', {
    mimeType,
    mediaType: isVideo ? 'video' : 'photo',
    fileSize: workingBuffer.length,
    fileSha256,
    payloadHash
  });

  const [media] = await db
    .insert(schema.mediaRecords)
    .values({
      domainId: domain.id,
      fileSha256,
      fingerprint: payloadHash,
      metadata: {
        mimeType,
        mediaType: isVideo ? 'video' : 'photo',
        originalName: safeFileName,
        size: workingBuffer.length,
        watermarkApplied: shouldWatermark,
        ...(deviceMetadata ? { deviceMetadata } : {})
      }
    })
    .returning();

  await db.insert(schema.signatures).values({
    mediaId: media.id,
    domainPublicKeyId: domainKeyId,
    signature,
    algorithm: 'ed25519'
  });

  await db.insert(schema.domainEvents).values({
    domainId: domain.id,
    eventType: 'media_signed',
    weight: '1',
    metadata: {
      mediaId: media.id
    }
  } satisfies typeof schema.domainEvents.$inferInsert);

  await updateDomainReputation(domain.id);
  logSignDebug('database_updates_complete', {
    domainId: domain.id,
    domainKeyId,
    mediaId: media.id
  });

  const identikStamp: IdentikStamp = {
    version: 1,
    identik_name: identikName,
    payload_sha256: payloadHash,
    key_fingerprint: keyFingerprint,
    signature,
    signed_at: new Date().toISOString()
  };

  const embedded: IdentikEmbeddedMetadata = {
    identik_stamp: identikStamp,
    canonical_payload: canonicalPayload
  };

  const embedStart = performance.now();
  let signedBuffer: Buffer = workingBuffer;
  let embedResult: EmbedResult = { buffer: workingBuffer, embedded: false, skippedReason: 'not_attempted' };
  try {
    embedResult = await withTimeout(
      embedIdentikMetadata(workingBuffer, embedded),
      EMBED_TIMEOUT_MS,
      () => {
        const error = new Error(`Embedding metadata timed out after ${EMBED_TIMEOUT_MS}ms.`);
        error.name = EMBED_TIMEOUT_ERROR_NAME;
        return error;
      }
    );
    signedBuffer = embedResult.buffer;
    logSignDebug('embed_complete', { durationMs: Math.round(performance.now() - embedStart) });
  } catch (error) {
    console.warn('[api/v1/sign] embedIdentikMetadata failed, returning unembedded buffer', error);
    embedResult = { buffer: workingBuffer, embedded: false, skippedReason: 'embed_failed' };
    signedBuffer = workingBuffer;
  }

  const summary = {
    identik_name: identikName,
    file_sha256: fileSha256,
    fingerprint: payloadHash,
    signature,
    mimeType,
    media_type: isVideo ? 'video' : 'photo',
    watermark_applied: shouldWatermark,
    metadata_embedded: embedResult?.embedded ?? false,
    metadata_embed_skipped_reason: embedResult?.skippedReason ?? null,
    device_metadata_present: Boolean(deviceMetadata)
  };

  const responseBody = new Uint8Array(signedBuffer);

  const response = new NextResponse(responseBody, {
    headers: {
      'Content-Type': mimeType,
      'Content-Disposition': `attachment; filename="${signedFileName}"`,
      'X-Identik-Summary': JSON.stringify(summary),
      'X-Identik-Watermark': shouldWatermark ? 'true' : 'false'
    }
  });

  logSignDebug('request_complete', {
    mediaId: media.id,
    payloadHash,
    durationMs: Math.round(performance.now() - requestStart)
  });

  return response;
}
