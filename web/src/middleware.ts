import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { isAllowed } from '@/server/rate-limit';

function getClientIp(request: NextRequest): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    'unknown'
  );
}

function rateLimitedResponse(): NextResponse {
  return NextResponse.json(
    { error: 'Too many requests. Please slow down and try again shortly.' },
    { status: 429 }
  );
}

export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  const ip = getClientIp(request);

  // Auth write endpoints (sign-in, sign-up, etc.): 15 attempts per 15 minutes per IP
  // get-session is excluded — it is called reactively on every render and must not share this bucket
  if (pathname.startsWith('/api/auth') && !pathname.startsWith('/api/auth/get-session')) {
    if (!isAllowed(`auth:${ip}`, 15, 15 * 60 * 1000)) {
      return rateLimitedResponse();
    }
  }

  // Sign endpoint: 30 requests per hour per IP
  if (pathname.startsWith('/api/v1/sign')) {
    if (!isAllowed(`sign:${ip}`, 30, 60 * 60 * 1000)) {
      return rateLimitedResponse();
    }
  }

  // Verify endpoint: 60 requests per minute per IP
  if (pathname.startsWith('/api/v1/verify') && !pathname.startsWith('/api/v1/verify/report')) {
    if (!isAllowed(`verify:${ip}`, 60, 60 * 1000)) {
      return rateLimitedResponse();
    }
  }

  // Report endpoint: 10 per hour per IP
  if (pathname.startsWith('/api/v1/verify/report')) {
    if (!isAllowed(`report:${ip}`, 10, 60 * 60 * 1000)) {
      return rateLimitedResponse();
    }
  }

  // Name availability check: 100 per minute per IP
  if (pathname.startsWith('/api/v1/names/available')) {
    if (!isAllowed(`names-avail:${ip}`, 100, 60 * 1000)) {
      return rateLimitedResponse();
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/api/:path*']
};
