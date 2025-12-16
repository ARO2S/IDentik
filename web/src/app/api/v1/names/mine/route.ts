import { db } from '@/server/db';
import { getAuthenticatedUser } from '@/server/auth';
import { json, unauthorized } from '@/server/http';
import { schema } from '@identik/database';
import { eq } from 'drizzle-orm';
import type { NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser(request);
  if (!user) {
    return unauthorized();
  }

  const domain = await db.query.domains.findFirst({
    where: eq(schema.domains.ownerUserId, user.id)
  });

  if (!domain) {
    return json({ owned: false });
  }

  return json({
    owned: true,
    identik_name: domain.name,
    status: domain.status,
    created_at: domain.createdAt?.toISOString?.() ?? null
  });
}

