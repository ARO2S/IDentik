'use client';

import { useSessionContext } from '@supabase/auth-helpers-react';
import { useState } from 'react';

const statusClass = (status: 'success' | 'error') =>
  status === 'success' ? 'status-banner status-success' : 'status-banner status-danger';

export const AuthPanel = () => {
  const { session, isLoading, supabaseClient } = useSessionContext();
  const [email, setEmail] = useState('demo@identik.dev');
  const [password, setPassword] = useState('identik-demo');
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

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
  };

  if (isLoading) {
    return <div className="card">Loading session…</div>;
  }

  return (
    <div className="card auth-panel-card">
      <h3>{session ? 'You are signed in' : 'Sign in to protect photos'}</h3>
      {session ? (
        <div className="auth-panel-session">
          <p>Welcome, {session.user.email}.</p>
          <button type="button" className="secondary-btn" onClick={signOut}>
            Sign out
          </button>
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
          </div>
          <div className="cta-row">
            <button type="submit" className="primary-btn" disabled={isSubmitting}>
              {isSubmitting ? 'Signing in…' : 'Sign in'}
            </button>
            <button type="button" className="secondary-btn" onClick={register} disabled={isSubmitting}>
              Create account
            </button>
          </div>
        </form>
      )}
      {status && (
        <div className={statusClass(status.type)} role="status">
          {status.message}
        </div>
      )}
    </div>
  );
};

export default AuthPanel;
