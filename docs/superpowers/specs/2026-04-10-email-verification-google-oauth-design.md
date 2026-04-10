# Email Verification + Google OAuth Design

**Date:** 2026-04-10
**Status:** Approved

## Goal

Add two auth improvements to IDentik:
1. Transactional email sending via Resend so `requireEmailVerification: true` can be re-enabled
2. Google OAuth as a second sign-in method alongside email+password

Both are surfaced through the existing `AuthPanel.tsx` component with minimal UI change.

---

## New Packages

| Package | Purpose |
|---|---|
| `resend` | Resend SDK for sending transactional email |
| `@react-email/components` | React-based email template primitives |
| `@react-email/render` | Server-side HTML renderer for React Email templates |

---

## Files Changed

| Action | File | Responsibility |
|---|---|---|
| Create | `web/src/emails/VerificationEmail.tsx` | Branded React Email verification template |
| Modify | `web/src/server/better-auth.ts` | Add Resend sender, Google social provider, re-enable email verification |
| Modify | `web/src/lib/auth-client.ts` | Add `socialProviders` plugin for client-side Google auth |
| Modify | `web/src/components/auth/AuthPanel.tsx` | Add Google sign-in button + divider above email form |
| Modify | `web/.env.local` | Add `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |

No database migration required — the `verification` table is already present in the Better Auth Drizzle adapter schema.

---

## Email Template (`VerificationEmail.tsx`)

A React Email component rendered server-side by Resend at send time.

**Layout (600px max-width, white background):**
- **Header:** Identik logo (`/public/assets/identik_logo_tagline_1000x500.svg`) centered
- **Body:** Short plain-English copy — "You're almost there. Verify your email to activate your Identik account."
- **CTA:** "Verify my email" button — styled to match `.primary-btn`, links to the Better Auth-provided verification URL (token already embedded in URL)
- **Expiry note:** "This link expires in 24 hours."
- **Footer:** "If you didn't create an account, you can safely ignore this email." + © Identik

Better Auth passes `{ user, url, token }` to `sendVerificationEmail`. The `url` is used directly as the button href — no manual token construction needed.

---

## Better Auth Server Config Changes

```ts
// web/src/server/better-auth.ts
import { Resend } from 'resend';
import { render } from '@react-email/render';
import { VerificationEmail } from '@/emails/VerificationEmail';

const resend = new Resend(process.env.RESEND_API_KEY);

export const auth = betterAuth({
  // ... existing database config unchanged ...
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 10,
    requireEmailVerification: true   // re-enabled
  },
  emailVerification: {
    sendVerificationEmail: async ({ user, url }) => {
      const html = await render(VerificationEmail({ verificationUrl: url }));
      await resend.emails.send({
        from: process.env.RESEND_FROM_EMAIL!,
        to: user.email,
        subject: 'Verify your Identik email',
        html
      });
    }
  },
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!
    }
  },
  plugins: [bearer()],   // socialProviders is a direct config key, not a plugin
  // ... existing advanced config unchanged ...
});
```

Google OAuth users are marked as email-verified automatically by Better Auth on first sign-in — no verification email is sent to them.

---

## Auth Client Changes

```ts
// web/src/lib/auth-client.ts
import { createAuthClient } from 'better-auth/react';

export const authClient = createAuthClient({
  baseURL: ...,
  plugins: []   // no client plugin needed for social providers in Better Auth v1
});
```

`authClient.signIn.social({ provider: 'google' })` is available on the base client without a plugin.

---

## AuthPanel UI Changes

Add a Google button and a divider above the existing email/password form. Signed-in state is unchanged.

```
┌─────────────────────────────────────┐
│  Access your Identik account        │
│  Sign in with your Identik email... │
│                                     │
│  [G  Continue with Google        ]  │
│                                     │
│  ────────────── or ─────────────── │
│                                     │
│  Email: [________________]          │
│  Password: [________________]       │
│                                     │
│  [Sign in]  [Create account]        │
└─────────────────────────────────────┘
```

The Google button calls:
```ts
await authClient.signIn.social({ provider: 'google' });
```

This redirects to Google and returns via Better Auth's existing `[...all]` catch-all route. No separate callback page is needed.

---

## Environment Variables

```bash
# Resend
RESEND_API_KEY=re_...
RESEND_FROM_EMAIL=noreply@yourdomain.com   # must be a Resend-verified domain

# Google OAuth
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```

**Google Cloud Console:** Add `http://localhost:3000/api/auth/callback/google` as an authorised redirect URI (and the production URL before deploying).

**Resend sending domain:** For development, `onboarding@resend.dev` works without domain verification. For production, add and verify your sending domain in the Resend dashboard.

---

## Error Handling

- If Resend fails to send, the error propagates up through Better Auth's `sendVerificationEmail` — Better Auth will return an error to the client. No silent failures.
- If Google OAuth fails (user cancels, token invalid), Better Auth redirects back to the app with an error query param. The existing `status` state in `AuthPanel` will surface this as an error message.
- Password helper text updated from "8 characters" to "10 characters" to match the enforced `minPasswordLength`.

---

## What This Does NOT Change

- The email+password sign-in and registration flow (form stays identical)
- The Identik Name claiming flow
- Any API routes
- The database schema
