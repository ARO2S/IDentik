import { db } from '@/server/db';
import { getAuthenticatedUser } from '@/server/auth';
import { badRequest, forbidden, json, unauthorized } from '@/server/http';
import { normalizeIdentikName, parseLabelFromName, sanitizeLabel, validateIdentikLabel } from '@/server/names';
import { schema } from '@identik/database';
import { eq } from 'drizzle-orm';
import type { NextRequest } from 'next/server';
import { z } from 'zod';

const purchaseSchema = z.object({
  name: z.string()
});

export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser(request);
  if (!user) {
    return unauthorized();
  }

  if (!user.email) {
    return badRequest('We need an email address on file before purchasing a name.');
  }

  await db
    .insert(schema.users)
    .values({
      id: user.id,
      email: user.email,
      displayName: user.email
    })
    .onConflictDoNothing({ target: schema.users.id });

  const body = await request.json().catch(() => null);
  const result = purchaseSchema.safeParse(body);
  if (!result.success) {
    return badRequest('Please provide a valid name.');
  }

  const label = sanitizeLabel(parseLabelFromName(result.data.name));
  if (!validateIdentikLabel(label)) {
    return badRequest('Names must be 3–32 characters and only use letters, numbers, or dashes.');
  }

  const identikName = normalizeIdentikName(label);

  const existing = await db.query.domains.findFirst({
    where: eq(schema.domains.name, identikName)
  });

  if (existing) {
    if (existing.ownerUserId === user.id) {
      return json({ identik_name: identikName, status: existing.status }, { status: 200 });
    }
    return forbidden('This Identik Name is already taken.');
  }

  const [inserted] = await db
    .insert(schema.domains)
    .values({
      name: identikName,
      ownerUserId: user.id,
      status: 'active'
    })
    .returning();

  return json(
    {
      identik_name: inserted.name,
      status: inserted.status
    },
    { status: 201 }
  );
}
