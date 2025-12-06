'use client';

import { useState } from 'react';
import { useSessionContext } from '@supabase/auth-helpers-react';

const NAME_SUFFIX = '.identik';

type Banner = {
  status: 'success' | 'error' | 'info';
  message: string;
};

const statusToClass = (status: Banner['status']) => {
  if (status === 'success') return 'status-banner status-success';
  if (status === 'error') return 'status-banner status-danger';
  return 'status-banner status-caution';
};

const formatLabel = (value: string) => value.trim().toLowerCase().replace(/\s+/g, '-');

export const IdentikNameForm = () => {
  const { session } = useSessionContext();
  const [name, setName] = useState('');
  const [banner, setBanner] = useState<Banner | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [isActivating, setIsActivating] = useState(false);

  const label = formatLabel(name);
  const identikName = label ? `${label}${NAME_SUFFIX}` : '';

  const checkAvailability = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!label) {
      setBanner({ status: 'error', message: 'Please enter a name to check.' });
      return;
    }
    setIsChecking(true);
    setBanner(null);
    try {
      const res = await fetch(`/api/v1/names/available?name=${encodeURIComponent(label)}`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error ?? 'Unable to check name right now.');
      }
      if (data.available) {
        setBanner({ status: 'success', message: `${data.identik_name} is ready for you.` });
      } else {
        setBanner({ status: 'info', message: `${data.identik_name} is already taken.` });
      }
    } catch (error) {
      setBanner({ status: 'error', message: error instanceof Error ? error.message : 'Something went wrong.' });
    } finally {
      setIsChecking(false);
    }
  };

  const activateName = async () => {
    if (!label) {
      setBanner({ status: 'error', message: 'Please enter a name to activate.' });
      return;
    }
    if (!session?.access_token) {
      setBanner({ status: 'error', message: 'Please sign in before activating your Identik Name.' });
      return;
    }
    setIsActivating(true);
    setBanner(null);
    try {
      const res = await fetch('/api/v1/names/purchase', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ name: label })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error ?? 'Unable to activate that Identik Name right now.');
      }
      setBanner({ status: 'success', message: `You now own ${data.identik_name}.` });
    } catch (error) {
      setBanner({
        status: 'error',
        message:
          error instanceof Error
            ? error.message
            : 'We could not activate that Identik Name. Please try again after signing in.'
      });
    } finally {
      setIsActivating(false);
    }
  };

  return (
    <form onSubmit={checkAvailability} aria-label="Create Identik Name">
      <div>
        <label htmlFor="identik-name">Pick your Identik Name</label>
        <input
          id="identik-name"
          type="text"
          placeholder="e.g. jenny"
          value={name}
          onChange={(event) => setName(event.target.value)}
          aria-describedby="identik-name-help"
        />
        <small id="identik-name-help" style={{ color: 'var(--text-muted)' }}>
          Letters, numbers, and dashes only. We’ll add {NAME_SUFFIX} for you.
        </small>
      </div>

      {identikName && (
        <div className="input-like" aria-live="polite">
          Your Identik Name will be <strong>{identikName}</strong>
        </div>
      )}

      <div className="cta-row">
        <button type="submit" className="primary-btn" disabled={isChecking}>
          {isChecking ? 'Checking…' : 'Check availability'}
        </button>
        <button type="button" className="secondary-btn" onClick={activateName} disabled={isActivating}>
          {isActivating ? 'Activating…' : 'Activate name'}
        </button>
      </div>

      {banner && (
        <div className={statusToClass(banner.status)} role="status">
          {banner.message}
        </div>
      )}
    </form>
  );
};

export default IdentikNameForm;
