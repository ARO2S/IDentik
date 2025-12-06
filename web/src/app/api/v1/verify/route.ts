import { db } from '@/server/db';
import { badRequest, json } from '@/server/http';
import { extractIdentikMetadata, normalizeBufferForVerification } from '@/server/metadata';
import { fileToBuffer } from '@/server/files';
import { fetchSignerSignals } from '@/server/signals';
import {
  canonicalPayloadHash,
  sha256Hex,
  verifyPayload
} from '@identik/crypto-utils';
import { schema } from '@identik/database';
import { calculateDomainReputation, updateDomainReputation } from '@identik/reputation';
import { eq } from 'drizzle-orm';
import type { NextRequest } from 'next/server';

export const runtime = 'nodejs';

const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));

const scoreToLabel = (score: number): 'Trusted' | 'Limited history' | 'Warning' | 'Not protected' => {
  if (score >= 0.75) return 'Trusted';
  if (score >= 0.5) return 'Limited history';
  if (score >= 0.25) return 'Warning';
  return 'Not protected';
};

const messageForLabel = (
  label: ReturnType<typeof scoreToLabel>,
  identikName?: string | null
) => {
  switch (label) {
    case 'Trusted':
      return `This photo was signed by ${identikName ?? 'an Identik Name'} and looks authentic based on our checks.`;
    case 'Limited history':
      return `We found an Identik stamp from ${identikName ?? 'this Name'}, but it’s still building history.`;
    case 'Warning':
      return `We found an Identik stamp from ${identikName ?? 'this Name'}, but something looked unusual.`;
    default:
      return "We couldn't verify Identik protection on this photo.";
  }
};

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const file = formData.get('file');

  if (!(file instanceof File)) {
    return badRequest('Please upload the photo you want to check.');
  }

  const buffer = await fileToBuffer(file);
  const embedded = await extractIdentikMetadata(buffer);

  if (!embedded) {
    return json({
      verified: false,
      score: 0,
      identik_name: null,
      label: 'Not protected',
      message: "We couldn't find an Identik protection stamp on this photo.",
      details: {
        domain_reputation: null,
        checks: [],
        warnings: ['No Identik metadata was found.']
      }
    });
  }

  const normalizedBuffer = await normalizeBufferForVerification(buffer);
  const fileSha256 = sha256Hex(normalizedBuffer);

  const { identik_stamp, canonical_payload } = embedded;
  const identikName = canonical_payload.identik_name;
  const payloadHash = canonicalPayloadHash(canonical_payload);

  const checks: string[] = [];
  const warnings: string[] = [];

  const isExactFileMatch = canonical_payload.file_sha256 === fileSha256;

  if (!isExactFileMatch) {
    warnings.push('The file contents have changed since it was protected.');
  } else {
    checks.push('Photo data matches the protected version.');
  }

  const domain = await db.query.domains.findFirst({
    where: eq(schema.domains.name, identikName)
  });

  if (!domain) {
    warnings.push('We could not find this Identik Name in our records.');
    return json({
      verified: false,
      score: 0.1,
      identik_name: identikName,
      label: 'Not protected',
      message: 'The Identik Name referenced in this photo is not active.',
      details: {
        domain_reputation: null,
        checks,
        warnings
      }
    });
  }

  const domainKey = await db.query.domainPublicKeys.findFirst({
    where: eq(schema.domainPublicKeys.keyFingerprint, identik_stamp.key_fingerprint)
  });

  let signatureValid = false;
  if (domainKey && !domainKey.revoked && domainKey.domainId === domain.id) {
    signatureValid = await verifyPayload(payloadHash, identik_stamp.signature, domainKey.publicKey);
  } else {
    warnings.push('The signing key referenced in the photo is not active for this Identik Name.');
  }

  if (signatureValid) {
    checks.push('Signature matched the Identik Name.');
  } else {
    warnings.push('We could not confirm that the signature matches this Identik Name.');
  }

  const media = await db.query.mediaRecords.findFirst({
    where: eq(schema.mediaRecords.fingerprint, payloadHash)
  });

  if (media) {
    checks.push('We found a matching protected photo in the Identik vault.');
  } else {
    warnings.push('We did not find a matching protected photo in the Identik vault.');
  }

  const signerSignals = await fetchSignerSignals(domain.id, db);

  if (signerSignals.totalSigned > 0) {
    checks.push(
      `This Identik Name has protected ${signerSignals.totalSigned} photo${
        signerSignals.totalSigned === 1 ? '' : 's'
      } so far.`
    );
  }

  if (signerSignals.reportCount > 0) {
    const percent = Math.round(signerSignals.reportRatio * 100);
    warnings.push(
      `Community members flagged ${signerSignals.reportCount} photo${
        signerSignals.reportCount === 1 ? '' : 's'
      } (${percent}% of their signed media) from this Identik Name as suspected AI.`
    );
  }

  const reputation = await calculateDomainReputation(domain.id, db);

  const createdAt = domain.createdAt ? new Date(domain.createdAt) : null;
  const domainAgeDays = createdAt ? Math.max((Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24), 0) : 0;

  if (domainAgeDays < 14) {
    warnings.push('This Identik Name is still very new and building history.');
  } else if (domainAgeDays > 180) {
    checks.push('This Identik Name has been active for a long time.');
  }

  const authenticityScore = clamp(
    (signatureValid ? 0.55 : 0) +
      (media ? 0.2 : 0) +
      (isExactFileMatch ? 0.15 : 0) -
      (!signatureValid ? 0.25 : 0) -
      (!isExactFileMatch ? 0.05 : 0),
    0,
    1
  );

  const historyScore = clamp(domainAgeDays / 180, 0, 1);
  const volumeScore = clamp(Math.log10(1 + signerSignals.totalSigned) / Math.log10(51), 0, 1);
  const reputationScore = clamp(reputation.score, 0, 1);
  const communityScore = 1 - clamp(signerSignals.reportRatio * 1.5, 0, 0.85);
  const trustScore = clamp(
    historyScore * 0.35 + volumeScore * 0.25 + communityScore * 0.25 + reputationScore * 0.15,
    0,
    1
  );

  const score = clamp(authenticityScore * 0.55 + trustScore * 0.45, 0, 0.98);

  const label = scoreToLabel(score);
  const verified = signatureValid && score >= 0.5;
  const message = messageForLabel(label, identikName);

  await db.insert(schema.verificationLogs).values({
    mediaId: media?.id ?? null,
    verified,
    score: score.toString(),
    report: {
      identik_name: identikName,
      checks,
      warnings
    }
  });

  await db.insert(schema.domainEvents).values({
    domainId: domain.id,
    eventType: verified ? 'verification_pass' : 'verification_fail',
    weight: verified ? '0.5' : '-0.5',
    metadata: {
      mediaId: media?.id ?? null,
      warnings,
      checks
    }
  });

  await updateDomainReputation(domain.id);

  return json({
    verified,
    score,
    identik_name: identikName,
    label,
    message,
    details: {
      domain_reputation: reputation.score,
      checks,
      warnings,
      signer_activity: signerSignals,
      domain_age_days: Math.round(domainAgeDays)
    },
    reporting: {
      identik_name: identikName,
      payload_hash: payloadHash,
      media_id: media?.id ?? null,
      domain_id: domain.id
    }
  });
}
