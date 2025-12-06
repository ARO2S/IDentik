import { db } from '@/server/db';
import { badRequest, json } from '@/server/http';
import { REPORT_EVENT_TYPE } from '@/server/signals';
import { schema } from '@identik/database';
import { updateDomainReputation } from '@identik/reputation';
import { eq } from 'drizzle-orm';
import type { NextRequest } from 'next/server';

export const runtime = 'nodejs';

type ReportBody = {
  identik_name?: string;
  payload_hash?: string;
  media_id?: string | null;
  domain_id?: string;
  reason?: string | null;
  contact?: string | null;
};

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as ReportBody | null;

  if (!body || !body.identik_name || !body.payload_hash) {
    return badRequest('Missing required report info.');
  }

  const identikName = body.identik_name.trim().toLowerCase();
  const domain = await db.query.domains.findFirst({
    where: eq(schema.domains.name, identikName)
  });

  if (!domain) {
    return badRequest('Identik Name not found.');
  }

  if (body.domain_id && body.domain_id !== domain.id) {
    return badRequest('Identik Name mismatch.');
  }

  let mediaId: string | null = null;
  if (body.media_id) {
    const media = await db.query.mediaRecords.findFirst({
      where: eq(schema.mediaRecords.id, body.media_id)
    });
    mediaId = media?.id ?? null;
  } else {
    const media = await db.query.mediaRecords.findFirst({
      where: eq(schema.mediaRecords.fingerprint, body.payload_hash)
    });
    mediaId = media?.id ?? null;
  }

  await db.insert(schema.domainEvents).values({
    domainId: domain.id,
    eventType: REPORT_EVENT_TYPE,
    weight: '-1',
    metadata: {
      mediaId,
      payloadHash: body.payload_hash,
      reason: body.reason ?? null,
      contact: body.contact ?? null
    }
  });

  await updateDomainReputation(domain.id);

  return json({ ok: true });
}
