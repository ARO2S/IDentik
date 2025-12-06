import { db } from '@/server/db';
import { getAuthenticatedUser } from '@/server/auth';
import { badRequest, forbidden, serverError, unauthorized } from '@/server/http';
import { normalizeIdentikName, parseLabelFromName } from '@/server/names';
import { appendSuffixToFileName, fileToBuffer, getSafeFileName } from '@/server/files';
import { embedIdentikMetadata, type IdentikEmbeddedMetadata, type IdentikStamp } from '@/server/metadata';
import { applyIdentikWatermark } from '@/server/watermark';
import {
  canonicalPayloadHash,
  createCanonicalPayload,
  fingerprintPublicKey,
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

export const runtime = 'nodejs';

const SIGN_DEBUG_ENABLED = process.env.SIGN_DEBUG === 'true';
const EMBED_TIMEOUT_MS = (() => {
  const parsed = Number(process.env.SIGN_EMBED_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30_000;
})();
const EMBED_TIMEOUT_ERROR_NAME = 'IdentikEmbedTimeoutError';

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
    return badRequest('Please attach the photo you want to protect.');
  }

  if (typeof identikNameInput !== 'string' || !identikNameInput.trim()) {
    return badRequest('Please choose the Identik Name to protect this photo under.');
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
    return forbidden('Only the owner of this Identik Name can protect photos with it.');
  }

  const privateKeyHex = process.env.DEV_SIGNING_PRIVATE_KEY;
  const publicKeyHex = process.env.DEV_SIGNING_PUBLIC_KEY;

  if (!privateKeyHex || !publicKeyHex) {
    return serverError('Signing keys are not configured.');
  }

  const shouldWatermark =
    typeof watermarkPreference === 'string'
      ? ['true', '1', 'yes', 'on'].includes(watermarkPreference.toLowerCase())
      : false;

  const originalBuffer = await fileToBuffer(file);
  const workingBuffer = shouldWatermark ? await applyIdentikWatermark(originalBuffer) : originalBuffer;
  const fileSha256 = sha256Hex(workingBuffer);
  const fileTypeInfo = await fileTypeFromBuffer(workingBuffer);
  const mimeType = fileTypeInfo?.mime ?? file.type ?? 'application/octet-stream';
  const safeFileName = getSafeFileName(file, fileTypeInfo?.ext ?? 'jpg');
  const signedFileName = appendSuffixToFileName(safeFileName, shouldWatermark ? '-identik-wm' : '-identik');

  const canonicalPayload = createCanonicalPayload({
    identikName,
    fileSha256,
    metadata: {
      mimeType,
      originalName: safeFileName,
      size: workingBuffer.length
    },
    timestamp: new Date().toISOString()
  });

  const payloadHash = canonicalPayloadHash(canonicalPayload);
  const signature = await signPayload(payloadHash, privateKeyHex);
  const keyFingerprint = fingerprintPublicKey(publicKeyHex);
  logSignDebug('file_ready', {
    mimeType,
    fileSize: workingBuffer.length,
    fileSha256,
    payloadHash
  });

  let domainKey = await db.query.domainPublicKeys.findFirst({
    where: eq(schema.domainPublicKeys.keyFingerprint, keyFingerprint)
  });

  if (!domainKey) {
    [domainKey] = await db
      .insert(schema.domainPublicKeys)
      .values({
        domainId: domain.id,
        keyType: 'ed25519',
        publicKey: publicKeyHex,
        keyFingerprint,
        metadata: { source: 'dev_env' }
      })
      .returning();
  }

  const [media] = await db
    .insert(schema.mediaRecords)
    .values({
      domainId: domain.id,
      fileSha256,
      fingerprint: payloadHash,
      metadata: {
        mimeType,
        originalName: safeFileName,
        size: workingBuffer.length,
        watermarkApplied: shouldWatermark
      }
    })
    .returning();

  await db.insert(schema.signatures).values({
    mediaId: media.id,
    domainPublicKeyId: domainKey.id,
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
    domainKeyId: domainKey.id,
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
  let signedBuffer: Buffer;
  try {
    signedBuffer = await withTimeout(
      embedIdentikMetadata(workingBuffer, embedded),
      EMBED_TIMEOUT_MS,
      () => {
        const error = new Error(`Embedding metadata timed out after ${EMBED_TIMEOUT_MS}ms.`);
        error.name = EMBED_TIMEOUT_ERROR_NAME;
        return error;
      }
    );
  } catch (error) {
    console.error('[api/v1/sign] embedIdentikMetadata failed', error);
    if (error instanceof Error && error.name === EMBED_TIMEOUT_ERROR_NAME) {
      return serverError('We could not finish protecting that photo before the timeout. Please try again.');
    }
    return serverError('We could not embed Identik metadata into that photo right now.');
  }
  logSignDebug('embed_complete', { durationMs: Math.round(performance.now() - embedStart) });

  const summary = {
    identik_name: identikName,
    file_sha256: fileSha256,
    fingerprint: payloadHash,
    signature,
    mimeType,
    watermark_applied: shouldWatermark
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
