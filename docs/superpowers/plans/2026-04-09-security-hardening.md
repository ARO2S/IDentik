# Security Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve all HIGH and MEDIUM security vulnerabilities identified in the 2026-04-09 security audit.

**Architecture:** All fixes are isolated to their own files — Tasks 1–6 touch distinct files and can be dispatched as parallel agents. Task 7 (rate limiting) introduces a new `middleware.ts` and a shared utility and is the only sequential dependency. Task 8 is manual env-file work.

**Tech Stack:** Next.js 14 (App Router), TypeScript, Better Auth, Drizzle ORM, Zod (already in `web/package.json`)

---

## Parallelization Map

```
Wave 1 (all parallel — no shared files):
  Task 1 — verify/route.ts:     file size limit + remove UUID leak
  Task 2 — sign/route.ts:       MIME allowlist + reject non-media files
  Task 3 — next.config.mjs:     security headers
  Task 4 — report/route.ts:     require auth + input length validation
  Task 5 — better-auth.ts:      password policy + email verification
  Task 6 — git:                 delete tmp/ scripts

Wave 2 (after Wave 1 — new files, no conflicts):
  Task 7 — middleware.ts:       in-memory rate limiting

Wave 3 (manual — not automated):
  Task 8 — .env.local:          rotate BETTER_AUTH_SECRET, set SIGN_DEBUG=false
```

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `web/src/app/api/v1/verify/route.ts` | Add 100 MB size guard; strip internal UUIDs from response |
| Modify | `web/src/app/api/v1/sign/route.ts` | MIME allowlist check; reject non-image/video |
| Modify | `web/next.config.mjs` | Add security headers via `headers()` async function |
| Modify | `web/src/app/api/v1/verify/report/route.ts` | Require auth; validate field lengths with Zod |
| Modify | `web/src/server/better-auth.ts` | Add `minPasswordLength`, `requireEmailVerification` |
| Delete | `tmp/direct-sign.ts`, `tmp/test-sign-small.ts` | Remove committed dev scripts |
| Create | `web/src/server/rate-limit.ts` | Sliding-window in-memory rate limiter utility |
| Create | `web/src/middleware.ts` | Next.js middleware applying rate limits per route |
| Manual | `web/.env.local` | Rotate `BETTER_AUTH_SECRET`; set `SIGN_DEBUG=false` |

---

## Task 1: Verify Route — File Size Guard + Strip Internal UUIDs

**Fixes:** HIGH-3, MED-5
**Files:**
- Modify: `web/src/app/api/v1/verify/route.ts`

### Context
- `runtime = 'nodejs'` removes Next.js's default 4 MB body cap
- `fileToBuffer` calls `Buffer.from(await file.arrayBuffer())` — entire file in memory
- The endpoint is unauthenticated
- `reporting.media_id` and `reporting.domain_id` return internal DB UUIDs to any caller

- [ ] **Step 1: Add file size guard after the `file instanceof File` check**

  Open `web/src/app/api/v1/verify/route.ts`. After line 48 (`if (!(file instanceof File))`), insert:

  ```ts
  const MAX_VERIFY_BYTES = 100 * 1024 * 1024; // 100 MB
  if (file.size > MAX_VERIFY_BYTES) {
    return badRequest('File is too large to verify. Maximum size is 100 MB.');
  }
  ```

- [ ] **Step 2: Strip internal UUIDs from the reporting block**

  Find the `reporting` block at the bottom of the `POST` function (around line 240):

  ```ts
  reporting: {
    identik_name: identikName,
    payload_hash: payloadHash,
    media_id: media?.id ?? null,
    domain_id: domain.id
  }
  ```

  Replace with (remove `media_id` and `domain_id`):

  ```ts
  reporting: {
    identik_name: identikName,
    payload_hash: payloadHash
  }
  ```

- [ ] **Step 3: Commit**

  ```bash
  cd /home/andyr/IDentik
  git add web/src/app/api/v1/verify/route.ts
  git commit -m "security: add 100MB size guard to verify endpoint; remove internal UUID leak"
  ```

---

## Task 2: Sign Route — MIME Allowlist + Reject Non-Media Files

**Fixes:** HIGH-4, MED-4
**Files:**
- Modify: `web/src/app/api/v1/sign/route.ts`

### Context
- `mimeType` falls back to user-supplied `file.type` when `file-type` library can't detect from magic bytes
- That `mimeType` is used verbatim as the `Content-Type` response header
- Non-image/video files get signed and stored in `mediaRecords` as if they were media

- [ ] **Step 1: Add MIME allowlist constant at the top of the file**

  After the import block (after line 34), add:

  ```ts
  const ALLOWED_MIME_TYPES = new Set([
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/heic',
    'image/heif',
    'video/mp4',
    'video/quicktime',
    'video/webm',
    'video/x-msvideo'
  ]);
  ```

- [ ] **Step 2: Validate MIME type and reject non-media files**

  Find this block (around lines 124–127):

  ```ts
  const originalBuffer = await fileToBuffer(file);
  const fileTypeInfo = await fileTypeFromBuffer(originalBuffer);
  const mimeType = fileTypeInfo?.mime ?? file.type ?? 'application/octet-stream';
  const isPhoto = mimeType.startsWith('image/');
  const isVideo = mimeType.startsWith('video/');
  ```

  Replace with:

  ```ts
  const originalBuffer = await fileToBuffer(file);
  const fileTypeInfo = await fileTypeFromBuffer(originalBuffer);
  const detectedMime = fileTypeInfo?.mime ?? null;
  // Only trust server-detected MIME; never use the browser-supplied file.type
  // for the response header or logic decisions.
  const mimeType = detectedMime ?? 'application/octet-stream';
  const isPhoto = mimeType.startsWith('image/');
  const isVideo = mimeType.startsWith('video/');

  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    return badRequest(
      'Only photos and videos can be protected. Please upload a JPEG, PNG, WebP, GIF, HEIC, MP4, MOV, or WebM file.'
    );
  }
  ```

- [ ] **Step 3: Commit**

  ```bash
  cd /home/andyr/IDentik
  git add web/src/app/api/v1/sign/route.ts
  git commit -m "security: restrict sign endpoint to allowed MIME types; use server-detected type only"
  ```

---

## Task 3: Security Headers

**Fixes:** HIGH-5
**Files:**
- Modify: `web/next.config.mjs`

### Context
- No `headers()` config exists today
- Missing headers that enable HIGH-4 exploitation: `X-Content-Type-Options: nosniff`
- Missing CSP leaves XSS vectors unmitigated

- [ ] **Step 1: Replace the entire `next.config.mjs` with headers added**

  Current content of `web/next.config.mjs`:

  ```js
  /** @type {import('next').NextConfig} */
  const nextConfig = {
    experimental: {
      serverComponentsExternalPackages: ['exiftool-vendored', 'batch-cluster']
    },
    webpack: (config) => {
      const extensionAlias = config.resolve?.extensionAlias ?? {};
      config.resolve = config.resolve ?? {};
      config.resolve.extensionAlias = {
        ...extensionAlias,
        '.js': ['.ts', '.tsx', '.js'],
        '.mjs': ['.mts', '.mjs'],
        '.cjs': ['.cts', '.cjs']
      };
      return config;
    }
  };

  export default nextConfig;
  ```

  Replace with:

  ```js
  /** @type {import('next').NextConfig} */
  const securityHeaders = [
    {
      key: 'X-DNS-Prefetch-Control',
      value: 'on'
    },
    {
      key: 'Strict-Transport-Security',
      value: 'max-age=63072000; includeSubDomains; preload'
    },
    {
      key: 'X-Frame-Options',
      value: 'SAMEORIGIN'
    },
    {
      key: 'X-Content-Type-Options',
      value: 'nosniff'
    },
    {
      key: 'Referrer-Policy',
      value: 'strict-origin-when-cross-origin'
    },
    {
      key: 'Permissions-Policy',
      value: 'camera=(), microphone=(), geolocation=()'
    },
    {
      key: 'Content-Security-Policy',
      value: [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self'",
        "connect-src 'self'",
        "media-src 'self' blob:",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'"
      ].join('; ')
    }
  ];

  const nextConfig = {
    experimental: {
      serverComponentsExternalPackages: ['exiftool-vendored', 'batch-cluster']
    },
    async headers() {
      return [
        {
          source: '/(.*)',
          headers: securityHeaders
        }
      ];
    },
    webpack: (config) => {
      const extensionAlias = config.resolve?.extensionAlias ?? {};
      config.resolve = config.resolve ?? {};
      config.resolve.extensionAlias = {
        ...extensionAlias,
        '.js': ['.ts', '.tsx', '.js'],
        '.mjs': ['.mts', '.mjs'],
        '.cjs': ['.cts', '.cjs']
      };
      return config;
    }
  };

  export default nextConfig;
  ```

  > **Note on CSP:** `unsafe-inline` and `unsafe-eval` are set permissively for now to avoid breaking the existing Next.js app. After this is deployed and confirmed working, tighten by enabling [Next.js nonce support](https://nextjs.org/docs/app/building-your-application/configuring/content-security-policy) and removing `unsafe-eval`.

- [ ] **Step 2: Commit**

  ```bash
  cd /home/andyr/IDentik
  git add web/next.config.mjs
  git commit -m "security: add security headers (HSTS, CSP, X-Frame-Options, X-Content-Type-Options)"
  ```

---

## Task 4: Report Endpoint — Require Auth + Input Validation

**Fixes:** HIGH-2, LOW-3
**Files:**
- Modify: `web/src/app/api/v1/verify/report/route.ts`

### Context
- Endpoint is fully unauthenticated today — anyone can spam reputation-destroying events
- `reason` and `contact` fields written to DB with no length validation
- `getAuthenticatedUser` is already available at `@/server/auth`
- `zod` is already in `web/package.json`

- [ ] **Step 1: Rewrite the report route to require auth and validate inputs**

  Replace the entire contents of `web/src/app/api/v1/verify/report/route.ts` with:

  ```ts
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
  ```

- [ ] **Step 2: Commit**

  ```bash
  cd /home/andyr/IDentik
  git add web/src/app/api/v1/verify/report/route.ts
  git commit -m "security: require auth on report endpoint; validate + limit input field lengths"
  ```

---

## Task 5: Better Auth — Password Policy + Email Verification

**Fixes:** MED-2
**Files:**
- Modify: `web/src/server/better-auth.ts`

### Context
- No `minPasswordLength` is set (Better Auth defaults to 8 — needs to be explicit)
- `requireEmailVerification` is not enabled, so unverified users can sign media
- Better Auth's `emailAndPassword` config accepts these options directly

- [ ] **Step 1: Update Better Auth config**

  Replace the entire contents of `web/src/server/better-auth.ts` with:

  ```ts
  import { betterAuth } from 'better-auth';
  import { drizzleAdapter } from 'better-auth/adapters/drizzle';
  import { bearer } from 'better-auth/plugins';
  import { getDb, schema } from '@identik/database';

  export const auth = betterAuth({
    database: drizzleAdapter(getDb(), {
      provider: 'pg',
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification
      }
    }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      requireEmailVerification: true
    },
    plugins: [bearer()],
    advanced: {
      database: {
        generateId: () => crypto.randomUUID()
      }
    }
  });
  ```

  > **Warning:** Enabling `requireEmailVerification: true` blocks sign-in for users who registered before this change and haven't verified their email. Confirm with the user whether to send a bulk re-verification email to existing unverified accounts, or add a grace period. If this breaks existing users in staging, it is working as intended.

- [ ] **Step 2: Commit**

  ```bash
  cd /home/andyr/IDentik
  git add web/src/server/better-auth.ts
  git commit -m "security: enforce 10-char min password and require email verification"
  ```

---

## Task 6: Delete Committed Dev Scripts

**Fixes:** MED-6
**Files:**
- Delete: `tmp/direct-sign.ts`
- Delete: `tmp/test-sign-small.ts`

### Context
- Both scripts are tracked in git and contain hardcoded demo credentials (`demo@identik.dev`, fallback password strings)
- They import `createAnonSupabaseClient` from the old Supabase client

- [ ] **Step 1: Remove both files and commit**

  ```bash
  cd /home/andyr/IDentik
  git rm tmp/direct-sign.ts tmp/test-sign-small.ts
  git commit -m "security: remove committed dev scripts with hardcoded demo credentials"
  ```

- [ ] **Step 2: Add tmp/ to .gitignore to prevent re-addition**

  Check if `.gitignore` already excludes `tmp/`:

  ```bash
  grep -n "tmp" /home/andyr/IDentik/.gitignore
  ```

  If not present, add to `.gitignore`:

  ```
  /tmp/
  tmp/
  ```

  Then:

  ```bash
  cd /home/andyr/IDentik
  git add .gitignore
  git commit -m "chore: add tmp/ to .gitignore"
  ```

---

## Task 7: Rate Limiting Middleware

**Fixes:** HIGH-1
**Files:**
- Create: `web/src/server/rate-limit.ts`
- Create: `web/src/middleware.ts`

### Context
- No rate limiting exists anywhere in the app
- Zero external dependencies needed — sliding-window in-memory implementation using a `Map`
- **Limitation:** In-memory rate limiting only works for single-instance deployments. For multi-instance production (e.g., multiple Vercel instances), upgrade to `@upstash/ratelimit` with Redis later
- Next.js `middleware.ts` must be placed at `web/src/middleware.ts` (next to the `app/` dir)
- The middleware runs for all routes by default; use the `matcher` config to target API routes only
- IP is read from the `x-forwarded-for` header (standard for Vercel, Railway, Render) with fallback to `x-real-ip`

- [ ] **Step 1: Create the rate limiter utility**

  Create `web/src/server/rate-limit.ts`:

  ```ts
  /**
   * Simple in-memory sliding window rate limiter.
   * Works for single-process deployments. For multi-instance production,
   * replace with @upstash/ratelimit backed by Redis.
   */

  type WindowEntry = {
    timestamps: number[];
  };

  const store = new Map<string, WindowEntry>();

  // Clean up old entries every 5 minutes to prevent unbounded memory growth
  if (typeof setInterval !== 'undefined') {
    setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of store.entries()) {
        if (entry.timestamps.length === 0 || now - entry.timestamps[entry.timestamps.length - 1] > 60_000) {
          store.delete(key);
        }
      }
    }, 5 * 60 * 1000);
  }

  /**
   * Returns true if the request is allowed, false if it should be rate-limited.
   * @param key      Unique key (e.g. "ip:route")
   * @param limit    Max requests allowed in the window
   * @param windowMs Window duration in milliseconds
   */
  export function isAllowed(key: string, limit: number, windowMs: number): boolean {
    const now = Date.now();
    const cutoff = now - windowMs;

    const entry = store.get(key) ?? { timestamps: [] };
    // Evict timestamps outside the window
    entry.timestamps = entry.timestamps.filter((t) => t > cutoff);
    entry.timestamps.push(now);
    store.set(key, entry);

    return entry.timestamps.length <= limit;
  }
  ```

- [ ] **Step 2: Create the Next.js middleware**

  Create `web/src/middleware.ts`:

  ```ts
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

    // Auth endpoints: 15 attempts per 15 minutes per IP
    if (pathname.startsWith('/api/auth')) {
      if (!isAllowed(`auth:${ip}`, 15, 15 * 60 * 1000)) {
        return rateLimitedResponse();
      }
    }

    // Sign endpoint: 30 requests per hour per IP (authenticated, so per-user would be better
    // once a user-ID is available in middleware; IP is sufficient for now)
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

    // Report endpoint: 10 per hour per IP (auth required separately in the route handler)
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
  ```

- [ ] **Step 3: Verify the middleware file is picked up by Next.js**

  Next.js requires `middleware.ts` to be at the root of the `src/` directory (not inside `app/`). Confirm placement:

  ```bash
  ls /home/andyr/IDentik/web/src/middleware.ts
  ```

  Expected output: `web/src/middleware.ts` (file exists, no error)

- [ ] **Step 4: Start the dev server and spot-check a rate limit**

  ```bash
  cd /home/andyr/IDentik/web && npm run dev &
  # Wait for "ready" message, then:
  for i in {1..20}; do curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/v1/names/available?name=test; done
  ```

  Expected: First 100 requests return `200` or `400`, request 101+ returns `429`.

  (The loop above only sends 20, so all should return non-429. To actually hit the limit, run it 101+ times or temporarily lower the limit to 5 in `middleware.ts` for testing.)

- [ ] **Step 5: Commit**

  ```bash
  cd /home/andyr/IDentik
  git add web/src/server/rate-limit.ts web/src/middleware.ts
  git commit -m "security: add in-memory sliding-window rate limiting to all API endpoints"
  ```

---

## Task 8: Manual Env File Hardening

**Fixes:** MED-1, MED-3
**Files:** (manual edits — do NOT commit these files)
- `web/.env.local`

### Context
- `BETTER_AUTH_SECRET` is currently `identik-better-auth-secret-change-in-production-32chars` — a readable placeholder
- `SIGN_DEBUG=true` logs `userId`, `fileSha256`, `payloadHash` to stdout on every sign request

- [ ] **Step 1: Generate a new BETTER_AUTH_SECRET**

  Run in terminal:

  ```bash
  openssl rand -hex 32
  ```

  Copy the output (a 64-character hex string).

- [ ] **Step 2: Update `web/.env.local`**

  Find the line:
  ```
  BETTER_AUTH_SECRET=identik-better-auth-secret-change-in-production-32chars
  ```

  Replace with:
  ```
  BETTER_AUTH_SECRET=<paste the openssl output here>
  ```

- [ ] **Step 3: Disable sign debug logging**

  Find the line:
  ```
  SIGN_DEBUG=true
  ```

  Replace with:
  ```
  SIGN_DEBUG=false
  ```

- [ ] **Step 4: Confirm `.env.local` is not tracked by git**

  ```bash
  cd /home/andyr/IDentik
  git ls-files web/.env.local
  ```

  Expected: no output. If it outputs the file path, run:
  ```bash
  git rm --cached web/.env.local
  echo "web/.env.local" >> .gitignore
  git add .gitignore
  git commit -m "chore: untrack .env.local from git"
  ```

---

## Post-Implementation Verification Checklist

After all tasks are complete:

- [ ] `GET /api/v1/names/available?name=test` returns a response (rate limiting doesn't block normal use)
- [ ] Uploading a `.exe` file to `/api/v1/sign` returns 400 (Task 2 working)
- [ ] Uploading a 200MB file to `/api/v1/verify` returns 400 (Task 1 working)
- [ ] `POST /api/v1/verify/report` without auth returns 401 (Task 4 working)
- [ ] Response headers include `X-Content-Type-Options: nosniff` (Task 3 working)
- [ ] `verify` response no longer includes `domain_id` or `media_id` fields (Task 1 working)
- [ ] `git ls-files tmp/` returns no output (Task 6 working)

---

## Not in this Plan (tracked separately)

- **CRIT-1:** Rotate Neon DB password, Ed25519 keypair, Supabase service-role key — requires out-of-band credential rotation and git history purge
- **CRIT-2:** Per-domain signing keys — significant architecture change, separate plan
- **LOW-4:** Stale "Supabase Auth" copy in `page.tsx` — content-only fix, low risk
