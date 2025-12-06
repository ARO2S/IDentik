import { db } from '@/server/db';
import { badRequest, json, notFound } from '@/server/http';
import { normalizeIdentikName, parseLabelFromName } from '@/server/names';
import { calculateDomainReputation } from '@identik/reputation';
import { schema } from '@identik/database';
import { eq } from 'drizzle-orm';
import type { NextRequest } from 'next/server';

interface Params {
  params: {
    name: string;
  };
}

export async function GET(request: NextRequest, { params }: Params) {
  if (!params.name) {
    return badRequest('Missing Identik Name.');
  }

  const label = parseLabelFromName(params.name);
  const identikName = normalizeIdentikName(label);

  const domain = await db.query.domains.findFirst({
    where: eq(schema.domains.name, identikName)
  });

  if (!domain) {
    return notFound('We do not recognize that Identik Name.');
  }

  const reputation = await calculateDomainReputation(domain.id, db);

  return json({
    identik_name: identikName,
    reputation_score: reputation.score,
    label: reputation.label,
    explanation: reputation.explanation
  });
}
