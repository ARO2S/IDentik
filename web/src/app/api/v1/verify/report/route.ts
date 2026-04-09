import { db } from '@/server/db';
import { getAuthenticatedUser } from '@/server/auth';
import { badRequest, json, unauthorized } from '@/server/http';
import { REPORT_EVENT_TYPE } from '@/server/signals';
import { schema } from '@identik/database';
import { updateDomainReputation } from '@identik/reputation';
import { eq } from 'drizzle-orm';
import type { NextRequest } from 'next/server';
import { z } from 'zod';

export const runtime = 'nodejs';

const reportSchema = z.object({
  identik_name: z.string().min(1).max(100),
  payload_hash: z.string().min(1).max(128),
  reason: z.string().max(500).nullable().optional(),
  contact: z.string().max(200).nullable().optional()
});

export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser(request);
  if (!user) {
    return unauthorized();
  }

  const raw = await request.json().catch(() => null);
  const parsed = reportSchema.safeParse(raw);

  if (!parsed.success) {
    return badRequest('Missing or invalid report fields.');
  }

  const { identik_name, payload_hash, reason, contact } = parsed.data;
  const identikName = identik_name.trim().toLowerCase();

  const domain = await db.query.domains.findFirst({
    where: eq(schema.domains.name, identikName)
  });

  if (!domain) {
    return badRequest('Identik Name not found.');
  }

  const media = await db.query.mediaRecords.findFirst({
    where: eq(schema.mediaRecords.fingerprint, payload_hash)
  });

  await db.insert(schema.domainEvents).values({
    domainId: domain.id,
    eventType: REPORT_EVENT_TYPE,
    weight: '-1',
    metadata: {
      mediaId: media?.id ?? null,
      payloadHash: payload_hash,
      reason: reason ?? null,
      contact: contact ?? null,
      reportedByUserId: user.id
    }
  });

  await updateDomainReputation(domain.id);

  return json({ ok: true });
}
