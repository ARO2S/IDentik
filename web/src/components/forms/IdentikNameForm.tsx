'use client';

import { useEffect, useState } from 'react';
import { useSessionContext } from '@supabase/auth-helpers-react';

const NAME_SUFFIX = '.identik';

type Props = {
  onClaimed?: (identikName: string) => void;
};

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

export const IdentikNameForm = ({ onClaimed }: Props) => {
  const { session } = useSessionContext();
  const [name, setName] = useState('');
  const [banner, setBanner] = useState<Banner | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [isActivating, setIsActivating] = useState(false);
  const [ownedName, setOwnedName] = useState<string | null>(null);
  const [ownershipStatus, setOwnershipStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [ownershipError, setOwnershipError] = useState<string | null>(null);

  const label = formatLabel(name);
  const identikName = label ? `${label}${NAME_SUFFIX}` : '';
  const hasDifferentOwnedName = Boolean(ownedName && identikName && ownedName !== identikName);

  useEffect(() => {
    let cancelled = false;

    if (!session?.access_token) {
      setOwnedName(null);
      setOwnershipStatus('idle');
      setOwnershipError(null);
      return;
    }

    const loadOwnedName = async () => {
      setOwnershipStatus('loading');
      setOwnershipError(null);
      try {
        const res = await fetch('/api/v1/names/mine', {
          headers: {
            Authorization: `Bearer ${session.access_token}`
          }
        });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          throw new Error(data?.error ?? 'Unable to load your Identik Name.');
        }
        setOwnedName(data?.owned ? data.identik_name ?? null : null);
        setOwnershipStatus('ready');
      } catch (error) {
        if (cancelled) return;
        setOwnedName(null);
        setOwnershipStatus('error');
        setOwnershipError(error instanceof Error ? error.message : 'Unable to load your Identik Name.');
      }
    };

    loadOwnedName();

    return () => {
      cancelled = true;
    };
  }, [session?.access_token]);

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
    if (hasDifferentOwnedName) {
      setBanner({
        status: 'info',
        message: `You already own ${ownedName}. Each account gets one Identik Name.`
      });
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
      const claimedName = data.identik_name ?? identikName;
      setOwnedName(claimedName);
      setOwnershipStatus('ready');
      setBanner({ status: 'success', message: `You now own ${claimedName}.` });
      onClaimed?.(claimedName);
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
    <form className="identik-name-form" onSubmit={checkAvailability} aria-label="Create Identik Name">
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
          Letters, numbers, and dashes only. We’ll add {NAME_SUFFIX} for you. Each account can claim one Identik Name.
        </small>
      </div>

      {identikName && (
        <div className="input-like" aria-live="polite">
          Your Identik Name will be <strong>{identikName}</strong>
        </div>
      )}

      {ownershipStatus === 'loading' && session && (
        <div className="status-banner status-caution" role="status">
          Checking if you already claimed a name…
        </div>
      )}

      {ownershipError && (
        <div className="status-banner status-danger" role="status">
          {ownershipError}
        </div>
      )}

      {ownedName && (
        <div className="status-banner status-success" role="status">
          <p style={{ margin: 0 }}>You already own</p>
          <strong style={{ display: 'block' }}>{ownedName}</strong>
          <p style={{ margin: 0 }}>Use this Identik Name when protecting photos.</p>
        </div>
      )}

      {hasDifferentOwnedName && (
        <div className="status-banner status-caution" role="status">
          Each account gets one Identik Name. You already claimed {ownedName}.
        </div>
      )}

      <div className="cta-row">
        <button type="submit" className="primary-btn" disabled={isChecking}>
          {isChecking ? 'Checking…' : 'Check availability'}
        </button>
        <button
          type="button"
          className="secondary-btn"
          onClick={activateName}
          disabled={isActivating || hasDifferentOwnedName}
        >
          {hasDifferentOwnedName ? 'One name per account' : isActivating ? 'Activating…' : 'Activate name'}
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
