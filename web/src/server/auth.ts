import { createServiceSupabaseClient } from '@identik/database';
import type { NextRequest } from 'next/server';

export interface AuthenticatedUser {
  id: string;
  email?: string | null;
}

const supabaseAdmin = createServiceSupabaseClient();

const extractBearerToken = (request: NextRequest): string | null => {
  const authorization = request.headers.get('authorization');
  if (!authorization) return null;
  const [scheme, token] = authorization.split(' ');
  if (!scheme || scheme.toLowerCase() !== 'bearer' || !token) return null;
  return token.trim();
};

export const getAuthenticatedUser = async (request: NextRequest): Promise<AuthenticatedUser | null> => {
  const token = extractBearerToken(request);
  if (!token) return null;

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user) {
    return null;
  }

  return {
    id: data.user.id,
    email: data.user.email
  };
};
