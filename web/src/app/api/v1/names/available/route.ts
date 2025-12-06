import { db } from '@/server/db';
import { json, badRequest } from '@/server/http';
import { normalizeIdentikName, parseLabelFromName, sanitizeLabel, validateIdentikLabel } from '@/server/names';
import { schema } from '@identik/database';
import { eq } from 'drizzle-orm';
import type { NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const nameParam = searchParams.get('name');

  if (!nameParam) {
    return badRequest('Please provide a name to check.');
  }

  const label = sanitizeLabel(parseLabelFromName(nameParam));
  if (!validateIdentikLabel(label)) {
    return badRequest('Names must be 3–32 characters and only use letters, numbers, or dashes.');
  }

  const identikName = normalizeIdentikName(label);

  const existing = await db.query.domains.findFirst({
    where: eq(schema.domains.name, identikName)
  });

  return json({
    available: !existing,
    identik_name: identikName,
    label
  });
}
