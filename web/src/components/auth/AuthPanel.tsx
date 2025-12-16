'use client';

import { useSessionContext } from '@supabase/auth-helpers-react';
import { useCallback, useEffect, useState } from 'react';
import IdentikNameForm from '@/components/forms/IdentikNameForm';

type NameStatus = 'idle' | 'loading' | 'ready' | 'error';

const statusClass = (status: 'success' | 'error') =>
  status === 'success' ? 'status-banner status-success' : 'status-banner status-danger';

export const AuthPanel = () => {
  const { session, isLoading, supabaseClient } = useSessionContext();
  const [email, setEmail] = useState('demo@identik.dev');
  const [password, setPassword] = useState('identik-demo');
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [nameStatus, setNameStatus] = useState<NameStatus>('idle');
  const [ownedName, setOwnedName] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [showClaimModal, setShowClaimModal] = useState(false);

  const fetchOwnedName = useCallback(async () => {
    if (!session?.access_token) return;
    setNameStatus('loading');
    setNameError(null);
    try {
      const res = await fetch('/api/v1/names/mine', {
        headers: {
          Authorization: `Bearer ${session.access_token}`
        }
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
  }, [session?.access_token]);

  useEffect(() => {
    let cancelled = false;

    if (!session?.access_token) {
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
  }, [session?.access_token, fetchOwnedName]);

  const signIn = async (event: React.FormEvent) => {
    event.preventDefault();
    setStatus(null);
    setIsSubmitting(true);
    try {
      const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
      if (error) throw error;
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
      const { error } = await supabaseClient.auth.signUp({ email, password });
      if (error) throw error;
      setStatus({ type: 'success', message: 'Check your email to verify and continue.' });
    } catch (error) {
      setStatus({ type: 'error', message: error instanceof Error ? error.message : 'Unable to register.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const signOut = async () => {
    await supabaseClient.auth.signOut();
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

  if (isLoading) {
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
                <p>You haven’t claimed an Identik Name yet.</p>
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
            <p className="input-helper">Use the email you’ll verify with Identik.</p>
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
            <p className="input-helper">Create at least 8 characters. New here? This will create your account.</p>
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
            After signing in, you’ll see whether you’ve already claimed an Identik Name—and if not, you can claim one in
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
              <button type="button" className="modal-close" aria-label="Close claim dialog" onClick={() => setShowClaimModal(false)}>
                ×
              </button>
            </div>
            <p className="modal-subhead">
              Reserve and purchase your Identik Name in one place. You’ll use this to protect photos.
            </p>
            <IdentikNameForm onClaimed={handleClaimed} />
          </div>
        </div>
      )}
    </div>
  );
};

export default AuthPanel;
