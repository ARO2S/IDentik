# Email Verification + Google OAuth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Resend-powered branded email verification and Google OAuth sign-in to IDentik using Better Auth v1.6.0.

**Architecture:** Three isolated changes — (1) a React Email template + render helper in `web/src/emails/`, (2) server config additions in `better-auth.ts` (Resend sender + Google social provider + re-enable `requireEmailVerification`), (3) a Google sign-in button added above the existing email form in `AuthPanel.tsx`. The email template exposes a `renderVerificationEmail` async helper so `better-auth.ts` stays a plain `.ts` file with no JSX.

**Tech Stack:** Next.js 14, Better Auth 1.6.0, Resend SDK, @react-email/components, @react-email/render, Vitest, TypeScript

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `web/vitest.config.ts` | Add `esbuild.jsx: 'automatic'` so tests can import `.tsx` files |
| Create | `web/src/emails/VerificationEmail.tsx` | Branded React Email template + `renderVerificationEmail` helper |
| Create | `web/src/emails/VerificationEmail.test.ts` | Vitest unit test for the render helper |
| Modify | `web/src/server/better-auth.ts` | Add Resend sender, Google social provider, re-enable email verification |
| Modify | `web/src/components/auth/AuthPanel.tsx` | Google sign-in button + divider above email form |
| Modify | `web/src/app/globals.css` | `.google-btn` and `.auth-divider` styles |
| Modify | `web/.env.local` | Add `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |

---

## Task 1: Install Packages + Configure Env

**Files:**
- Modify: `web/package.json` (via npm install)
- Modify: `web/.env.local`

- [ ] **Step 1: Install Resend and React Email packages**

  ```bash
  cd /home/andyr/IDentik/web
  npm install resend @react-email/components @react-email/render
  ```

  Expected: packages added to `dependencies` in `package.json`, no peer dep errors.

- [ ] **Step 2: Add env vars to `web/.env.local`**

  Open `web/.env.local` and append these four lines at the bottom under a `# === Email (Resend) ===` comment:

  ```bash
  # === Email (Resend) ===
  RESEND_API_KEY=re_YOUR_KEY_HERE
  # During development use onboarding@resend.dev if you haven't verified a sending domain yet
  RESEND_FROM_EMAIL=onboarding@resend.dev

  # === Google OAuth ===
  GOOGLE_CLIENT_ID=YOUR_GOOGLE_CLIENT_ID
  GOOGLE_CLIENT_SECRET=YOUR_GOOGLE_CLIENT_SECRET
  ```

  Replace the placeholder values with your real credentials.

  > **Google Cloud Console:** Ensure `http://localhost:3000/api/auth/callback/google` is listed as an Authorised Redirect URI for your OAuth client. Add your production URL too when you deploy.

- [ ] **Step 3: Commit**

  ```bash
  cd /home/andyr/IDentik
  git add web/package.json web/package-lock.json
  git commit -m "chore: install resend and react-email packages"
  ```

  (Do NOT commit `web/.env.local` — it is already gitignored.)

---

## Task 2: Add JSX Support to Vitest

**Files:**
- Modify: `web/vitest.config.ts`

- [ ] **Step 1: Update `web/vitest.config.ts` to enable automatic JSX transform**

  Replace the entire contents of `web/vitest.config.ts` with:

  ```ts
  import { defineConfig } from 'vitest/config';
  import path from 'path';

  export default defineConfig({
    esbuild: {
      jsx: 'automatic'
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src')
      }
    },
    test: {
      environment: 'node',
      globals: false
    }
  });
  ```

  The `esbuild.jsx: 'automatic'` option tells esbuild to use React 18's automatic JSX runtime (`react/jsx-runtime`), so `.tsx` files can be imported in tests without needing `import React from 'react'` in every file.

- [ ] **Step 2: Verify existing tests still pass**

  ```bash
  cd /home/andyr/IDentik/web
  npm test
  ```

  Expected: all existing tests in `src/server/pHashUtils.test.ts` pass. No failures.

- [ ] **Step 3: Commit**

  ```bash
  cd /home/andyr/IDentik
  git add web/vitest.config.ts
  git commit -m "chore: add automatic JSX transform to vitest config"
  ```

---

## Task 3: Create VerificationEmail Template

**Files:**
- Create: `web/src/emails/VerificationEmail.tsx`
- Create: `web/src/emails/VerificationEmail.test.ts`

- [ ] **Step 1: Write the failing test first**

  Create `web/src/emails/VerificationEmail.test.ts`:

  ```ts
  import { describe, expect, it } from 'vitest';
  import { renderVerificationEmail } from './VerificationEmail.js';

  describe('renderVerificationEmail', () => {
    it('includes the verification URL in the rendered HTML', async () => {
      const url = 'https://example.com/api/auth/verify-email?token=abc123';
      const html = await renderVerificationEmail({ verificationUrl: url });
      expect(html).toContain(url);
    });

    it('includes the CTA button text', async () => {
      const html = await renderVerificationEmail({
        verificationUrl: 'https://example.com/api/auth/verify-email?token=xyz'
      });
      expect(html).toContain('Verify my email');
    });

    it('includes the Identik brand name', async () => {
      const html = await renderVerificationEmail({
        verificationUrl: 'https://example.com/api/auth/verify-email?token=xyz'
      });
      expect(html).toContain('Identik');
    });

    it('includes the expiry notice', async () => {
      const html = await renderVerificationEmail({
        verificationUrl: 'https://example.com/api/auth/verify-email?token=xyz'
      });
      expect(html).toContain('24 hours');
    });

    it('uses a custom logoUrl when provided', async () => {
      const logoUrl = 'https://cdn.example.com/logo.svg';
      const html = await renderVerificationEmail({
        verificationUrl: 'https://example.com/verify',
        logoUrl
      });
      expect(html).toContain(logoUrl);
    });
  });
  ```

- [ ] **Step 2: Run the test to confirm it fails**

  ```bash
  cd /home/andyr/IDentik/web
  npm test -- src/emails/VerificationEmail.test.ts
  ```

  Expected: FAIL — `Cannot find module './VerificationEmail.js'`

- [ ] **Step 3: Create `web/src/emails/VerificationEmail.tsx`**

  ```tsx
  import {
    Body,
    Button,
    Container,
    Head,
    Hr,
    Html,
    Img,
    Preview,
    Section,
    Text
  } from '@react-email/components';
  import { render } from '@react-email/render';

  export interface VerificationEmailProps {
    verificationUrl: string;
    /**
     * Absolute URL to the Identik logo. Must be absolute for email clients.
     * Defaults to the production logo URL.
     */
    logoUrl?: string;
  }

  export const VerificationEmail = ({
    verificationUrl,
    logoUrl = 'https://identik.dev/assets/identik_logo_tagline_1000x500.svg'
  }: VerificationEmailProps) => (
    <Html lang="en">
      <Head />
      <Preview>Verify your email to activate your Identik account</Preview>
      <Body style={{ backgroundColor: '#f5f7fb', fontFamily: 'Inter, system-ui, sans-serif', margin: '0', padding: '0' }}>
        <Container style={{ maxWidth: '600px', margin: '40px auto', backgroundColor: '#ffffff', borderRadius: '12px', padding: '40px' }}>
          <Img
            src={logoUrl}
            alt="Identik"
            width={240}
            height={120}
            style={{ display: 'block', margin: '0 auto 32px', height: 'auto' }}
          />
          <Text style={{ fontSize: '24px', fontWeight: 'bold', color: '#0d1b2a', textAlign: 'center', margin: '0 0 16px 0' }}>
            You&apos;re almost there.
          </Text>
          <Text style={{ fontSize: '16px', color: '#4a5668', textAlign: 'center', margin: '0 0 32px 0', lineHeight: '1.5' }}>
            Verify your email to activate your Identik account and start protecting your photos.
          </Text>
          <Section style={{ textAlign: 'center', margin: '0 0 24px 0' }}>
            <Button
              href={verificationUrl}
              style={{
                backgroundColor: '#1a4d8f',
                color: '#ffffff',
                padding: '14px 32px',
                borderRadius: '8px',
                fontSize: '16px',
                fontWeight: '600',
                textDecoration: 'none',
                display: 'inline-block'
              }}
            >
              Verify my email
            </Button>
          </Section>
          <Text style={{ fontSize: '14px', color: '#4a5668', textAlign: 'center', margin: '0 0 24px 0' }}>
            This link expires in 24 hours.
          </Text>
          <Hr style={{ borderColor: '#d1d8e5', margin: '0 0 24px 0' }} />
          <Text style={{ fontSize: '13px', color: '#4a5668', textAlign: 'center', margin: '0 0 8px 0' }}>
            If you didn&apos;t create an Identik account, you can safely ignore this email.
          </Text>
          <Text style={{ fontSize: '13px', color: '#4a5668', textAlign: 'center', margin: '0' }}>
            &copy; {new Date().getFullYear()} Identik. All rights reserved.
          </Text>
        </Container>
      </Body>
    </Html>
  );

  /**
   * Renders the VerificationEmail component to an HTML string.
   * Call this from server-side code (e.g. better-auth.ts) to get the email body.
   */
  export const renderVerificationEmail = async (props: VerificationEmailProps): Promise<string> => {
    return render(<VerificationEmail {...props} />);
  };

  export default VerificationEmail;
  ```

- [ ] **Step 4: Run the test to confirm it passes**

  ```bash
  cd /home/andyr/IDentik/web
  npm test -- src/emails/VerificationEmail.test.ts
  ```

  Expected: 5 tests pass.

- [ ] **Step 5: Commit**

  ```bash
  cd /home/andyr/IDentik
  git add web/src/emails/VerificationEmail.tsx web/src/emails/VerificationEmail.test.ts
  git commit -m "feat(web): add branded React Email verification template with render helper"
  ```

---

## Task 4: Update Better Auth Config

**Files:**
- Modify: `web/src/server/better-auth.ts`

- [ ] **Step 1: Replace the entire contents of `web/src/server/better-auth.ts`**

  ```ts
  import { betterAuth } from 'better-auth';
  import { drizzleAdapter } from 'better-auth/adapters/drizzle';
  import { bearer } from 'better-auth/plugins';
  import { getDb, schema } from '@identik/database';
  import { Resend } from 'resend';
  import { renderVerificationEmail } from '@/emails/VerificationEmail';

  const resend = new Resend(process.env.RESEND_API_KEY);

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
    emailVerification: {
      sendVerificationEmail: async ({ user, url }) => {
        const logoUrl = `${process.env.NEXT_PUBLIC_APP_URL}/assets/identik_logo_tagline_1000x500.svg`;
        const html = await renderVerificationEmail({ verificationUrl: url, logoUrl });
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
    plugins: [bearer()],
    advanced: {
      database: {
        generateId: () => crypto.randomUUID()
      }
    }
  });
  ```

- [ ] **Step 2: Verify the dev server starts without TypeScript errors**

  ```bash
  cd /home/andyr/IDentik/web
  npm run dev
  ```

  Expected: server starts on `http://localhost:3000` with no module resolution errors or TypeScript compilation errors in the terminal. Stop it with Ctrl+C after confirming.

- [ ] **Step 3: Commit**

  ```bash
  cd /home/andyr/IDentik
  git add web/src/server/better-auth.ts
  git commit -m "feat(web): add Resend email verification and Google OAuth to Better Auth config"
  ```

---

## Task 5: Add Google Sign-in Button to AuthPanel

**Files:**
- Modify: `web/src/components/auth/AuthPanel.tsx`
- Modify: `web/src/app/globals.css`

- [ ] **Step 1: Add CSS for Google button and divider to `web/src/app/globals.css`**

  Append the following to the end of `web/src/app/globals.css`:

  ```css
  /* ── Auth: Google sign-in button ── */
  .google-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.625rem;
    width: 100%;
    padding: 0.75rem 1.25rem;
    background: var(--white);
    color: var(--text-primary);
    border: 1.5px solid var(--border-color);
    border-radius: 0.5rem;
    font-size: 0.9375rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s;
  }

  .google-btn:hover:not(:disabled) {
    background: var(--soft-gray);
    border-color: #b0bac9;
  }

  .google-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  /* ── Auth: "or" divider ── */
  .auth-divider {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    color: var(--text-muted);
    font-size: 0.8125rem;
    margin: 0.25rem 0;
  }

  .auth-divider::before,
  .auth-divider::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--border-color);
  }
  ```

- [ ] **Step 2: Update `web/src/components/auth/AuthPanel.tsx`**

  Replace the entire file contents with:

  ```tsx
  'use client';

  import { authClient } from '@/lib/auth-client';
  import { useCallback, useEffect, useState } from 'react';
  import IdentikNameForm from '@/components/forms/IdentikNameForm';

  type NameStatus = 'idle' | 'loading' | 'ready' | 'error';

  const statusClass = (status: 'success' | 'error') =>
    status === 'success' ? 'status-banner status-success' : 'status-banner status-danger';

  const GoogleIcon = () => (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.964 10.707A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.707V4.961H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.039l3.007-2.332z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.961L3.964 7.293C4.672 5.163 6.656 3.58 9 3.58z"
      />
    </svg>
  );

  export const AuthPanel = () => {
    const { data: sessionData, isPending } = authClient.useSession();
    const session = sessionData ?? null;
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [nameStatus, setNameStatus] = useState<NameStatus>('idle');
    const [ownedName, setOwnedName] = useState<string | null>(null);
    const [nameError, setNameError] = useState<string | null>(null);
    const [showClaimModal, setShowClaimModal] = useState(false);

    const token = session?.session?.token ?? null;

    const fetchOwnedName = useCallback(async () => {
      if (!token) return;
      setNameStatus('loading');
      setNameError(null);
      try {
        const res = await fetch('/api/v1/names/mine', {
          headers: { Authorization: `Bearer ${token}` }
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data?.error ?? 'Unable to load your Identik Name.');
        }
        setOwnedName(data?.owned ? data.identik_name ?? null : null);
        setNameStatus('ready');
      } catch (error) {
        setOwnedName(null);
        setNameStatus('error');
        setNameError(error instanceof Error ? error.message : 'Unable to load your Identik Name.');
      }
    }, [token]);

    useEffect(() => {
      let cancelled = false;

      if (!token) {
        setOwnedName(null);
        setNameStatus('idle');
        setNameError(null);
        return;
      }

      const loadOwnedName = async () => {
        await fetchOwnedName();
        if (cancelled) return;
      };

      loadOwnedName();

      return () => {
        cancelled = true;
      };
    }, [token, fetchOwnedName]);

    const signIn = async (event: React.FormEvent) => {
      event.preventDefault();
      setStatus(null);
      setIsSubmitting(true);
      try {
        const { error } = await authClient.signIn.email({ email, password });
        if (error) throw new Error(error.message || error.code || 'Unable to sign in.');
        setStatus({ type: 'success', message: 'Signed in. You can now protect photos under your Identik Name.' });
      } catch (error) {
        setStatus({ type: 'error', message: error instanceof Error ? error.message : 'Unable to sign in.' });
      } finally {
        setIsSubmitting(false);
      }
    };

    const register = async () => {
      setStatus(null);
      setIsSubmitting(true);
      try {
        const { error } = await authClient.signUp.email({ email, password, name: email });
        if (error) throw new Error(error.message || error.code || 'Unable to register.');
        setStatus({ type: 'success', message: 'Account created. Check your email to verify and continue.' });
      } catch (error) {
        setStatus({ type: 'error', message: error instanceof Error ? error.message : 'Unable to register.' });
      } finally {
        setIsSubmitting(false);
      }
    };

    const signInWithGoogle = async () => {
      setStatus(null);
      setIsSubmitting(true);
      try {
        await authClient.signIn.social({ provider: 'google' });
        // Redirects to Google — page will navigate away; no further state update needed
      } catch (error) {
        setStatus({ type: 'error', message: 'Unable to sign in with Google. Please try again.' });
        setIsSubmitting(false);
      }
    };

    const signOut = async () => {
      await authClient.signOut();
      setStatus({ type: 'success', message: 'Signed out.' });
      setOwnedName(null);
      setNameStatus('idle');
      setNameError(null);
      setShowClaimModal(false);
    };

    const handleClaimed = (name: string) => {
      setOwnedName(name);
      setNameStatus('ready');
      setShowClaimModal(false);
      setStatus({ type: 'success', message: `You now own ${name}.` });
    };

    if (isPending) {
      return <div className="card">Loading session…</div>;
    }

    return (
      <div className="card auth-panel-card">
        <div className="auth-panel-header">
          <h3>{session ? 'You are signed in' : 'Access your Identik account'}</h3>
          <p className="auth-panel-subhead">
            {session
              ? 'Claim or view your Identik Name, then start protecting photos.'
              : 'Sign in with your Identik email, or create an account to claim your Identik Name.'}
          </p>
        </div>
        {session ? (
          <div className="auth-panel-session">
            <div className="auth-session-meta">
              <p className="eyebrow">Signed in</p>
              <p className="auth-session-email">{session.user.email}</p>
            </div>

            <div className="auth-domain-box">
              <div className="auth-domain-head">
                <span>Your Identik Name</span>
                {nameStatus === 'loading' && <span className="status-pill muted">Checking…</span>}
                {nameStatus === 'ready' && ownedName && <span className="status-pill success">Claimed</span>}
                {nameStatus === 'ready' && !ownedName && <span className="status-pill warning">Not claimed</span>}
              </div>

              {nameStatus === 'error' && (
                <div className="status-banner status-danger" role="status">
                  {nameError}
                </div>
              )}

              {nameStatus === 'loading' && <p className="auth-panel-footnote">Checking your claim status…</p>}

              {nameStatus === 'ready' && ownedName && (
                <div className="domain-pill" aria-live="polite">
                  {ownedName}
                </div>
              )}

              {nameStatus === 'ready' && !ownedName && (
                <div className="auth-domain-empty">
                  <p>You haven&apos;t claimed an Identik Name yet.</p>
                  <p className="auth-panel-footnote">
                    Claim a domain like <strong>yourname.identik</strong> before protecting photos.
                  </p>
                  <button type="button" className="primary-btn" onClick={() => setShowClaimModal(true)}>
                    Claim your Identik Name
                  </button>
                </div>
              )}
            </div>

            <div className="cta-row auth-panel-actions">
              <a className="secondary-btn" href="#protect-photo">
                Protect a photo
              </a>
              <button type="button" className="secondary-btn" onClick={signOut}>
                Sign out
              </button>
            </div>
          </div>
        ) : (
          <form className="auth-panel-form" onSubmit={signIn}>
            <button type="button" className="google-btn" onClick={signInWithGoogle} disabled={isSubmitting}>
              <GoogleIcon />
              Continue with Google
            </button>

            <div className="auth-divider">or</div>

            <div>
              <label htmlFor="login-email">Email</label>
              <input
                id="login-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                required
              />
              <p className="input-helper">Use the email you&apos;ll verify with Identik.</p>
            </div>
            <div>
              <label htmlFor="login-password">Password</label>
              <input
                id="login-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="••••••••"
                required
              />
              <p className="input-helper">At least 10 characters. New here? This will create your account.</p>
            </div>
            <div className="cta-row auth-panel-actions">
              <button type="submit" className="primary-btn" disabled={isSubmitting}>
                {isSubmitting ? 'Signing in…' : 'Sign in'}
              </button>
              <button type="button" className="secondary-btn" onClick={register} disabled={isSubmitting}>
                Create account
              </button>
            </div>

            <p className="auth-panel-footnote">
              After signing in, you&apos;ll see whether you&apos;ve already claimed an Identik Name—and if not, you can claim one in
              the box right away.
            </p>
          </form>
        )}
        {status && (
          <div className={statusClass(status.type)} role="status">
            {status.message}
          </div>
        )}

        {showClaimModal && (
          <div className="modal-backdrop" role="presentation" onClick={() => setShowClaimModal(false)}>
            <div
              className="modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="claim-identik-title"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="modal-header">
                <h4 id="claim-identik-title">Claim your Identik Name</h4>
                <button
                  type="button"
                  className="modal-close"
                  aria-label="Close claim dialog"
                  onClick={() => setShowClaimModal(false)}
                >
                  ×
                </button>
              </div>
              <p className="modal-subhead">
                Reserve and purchase your Identik Name in one place. You&apos;ll use this to protect photos.
              </p>
              <IdentikNameForm onClaimed={handleClaimed} />
            </div>
          </div>
        )}
      </div>
    );
  };

  export default AuthPanel;
  ```

- [ ] **Step 3: Run all tests to confirm nothing broke**

  ```bash
  cd /home/andyr/IDentik/web
  npm test
  ```

  Expected: all tests pass (pHashUtils + VerificationEmail).

- [ ] **Step 4: Commit**

  ```bash
  cd /home/andyr/IDentik
  git add web/src/components/auth/AuthPanel.tsx web/src/app/globals.css
  git commit -m "feat(web): add Google sign-in button and divider to AuthPanel"
  ```

---

## Post-Implementation Manual Verification

After all tasks are committed, start the dev server and verify these manually:

```bash
cd /home/andyr/IDentik/web && npm run dev
```

- [ ] **Google sign-in button** appears above the email form at `http://localhost:3000/#sign-in`
- [ ] Clicking "Continue with Google" redirects to Google's OAuth consent screen
- [ ] After Google auth, you are redirected back and signed in (session shown in AuthPanel)
- [ ] Registering with email+password shows the success message "Account created. Check your email to verify and continue."
- [ ] A verification email arrives in the inbox from `RESEND_FROM_EMAIL` with the Identik branding and a working "Verify my email" button
- [ ] Attempting to sign in with email+password before verifying shows a verification-required error from Better Auth
- [ ] After clicking the verification link in the email, signing in with email+password succeeds
