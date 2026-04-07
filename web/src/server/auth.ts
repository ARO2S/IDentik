import { auth } from '@/server/better-auth';
import type { NextRequest } from 'next/server';

export interface AuthenticatedUser {
  id: string;
  email?: string | null;
}

export const getAuthenticatedUser = async (request: NextRequest): Promise<AuthenticatedUser | null> => {
  const session = await auth.api.getSession({
    headers: request.headers
  });

  if (!session?.user) {
    return null;
  }

  return {
    id: session.user.id,
    email: session.user.email
  };
};
