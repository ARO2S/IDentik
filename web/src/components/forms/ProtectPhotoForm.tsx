'use client';

import { useEffect, useRef, useState } from 'react';
import { useSessionContext } from '@supabase/auth-helpers-react';

const statusToClass = (status: 'success' | 'error' | 'info') => {
  if (status === 'success') return 'status-banner status-success';
  if (status === 'error') return 'status-banner status-danger';
  return 'status-banner status-caution';
};

const getFileNameFromContentDisposition = (headerValue: string | null): string | null => {
  if (!headerValue) return null;

  const filenameStarMatch = headerValue.match(/filename\*=([^']*)''([^;]+)/i);
  if (filenameStarMatch?.[2]) {
    try {
      return decodeURIComponent(filenameStarMatch[2]);
    } catch {
      return filenameStarMatch[2];
    }
  }

  const quotedFilenameMatch = headerValue.match(/filename="([^"]+)"/i);
  if (quotedFilenameMatch?.[1]) {
    return quotedFilenameMatch[1];
  }

  const fallbackMatch = headerValue.match(/filename=([^;]+)/i);
  if (fallbackMatch?.[1]) {
    const value = fallbackMatch[1].trim().replace(/^['"]|['"]$/g, '');
    return value || null;
  }

  return null;
};

export const ProtectPhotoForm = () => {
  const { session } = useSessionContext();
  const formRef = useRef<HTMLFormElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [status, setStatus] = useState<{ kind: 'success' | 'error' | 'info'; message: string } | null>(null);
  const [includeWatermark, setIncludeWatermark] = useState(true);
  const [identikName, setIdentikName] = useState('');
  const [claimedName, setClaimedName] = useState<string | null>(null);
  const [nameStatus, setNameStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [nameError, setNameError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (!session?.access_token) {
      setIdentikName('');
      setClaimedName(null);
      setNameStatus('idle');
      setNameError(null);
      return;
    }

    const loadOwnedName = async () => {
      setNameStatus('loading');
      setNameError(null);
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
        const owned = data?.owned ? data.identik_name ?? '' : '';
        setClaimedName(owned || null);
        setIdentikName(owned);
        setNameStatus('ready');
      } catch (error) {
        if (cancelled) return;
        setClaimedName(null);
        setNameStatus('error');
        setNameError(error instanceof Error ? error.message : 'Unable to load your Identik Name.');
      }
    };

    loadOwnedName();

    return () => {
      cancelled = true;
    };
  }, [session?.access_token]);

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = formRef.current;
    if (!form) return;

    const formData = new FormData(form);
    const identikNameValue = identikName.trim();
    const file = fileInputRef.current?.files?.[0];

    if (!identikNameValue) {
      setStatus({ kind: 'error', message: 'Please enter your Identik Name.' });
      return;
    }

    if (!file) {
      setStatus({ kind: 'error', message: 'Please choose the photo or video you want to protect.' });
      return;
    }

    if (!session?.access_token) {
      setStatus({ kind: 'error', message: 'Please sign in before protecting a photo or video.' });
      return;
    }

    setIsSubmitting(true);
    setStatus(null);

    try {
      formData.set('identikName', identikNameValue);
      formData.set('watermark', includeWatermark ? 'true' : 'false');
      const response = await fetch('/api/v1/sign', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: formData
      });

      if (!response.ok) {
        const error = await response
          .json()
          .catch(() => ({ error: 'Unable to protect that photo or video right now.' }));
        throw new Error(error?.error ?? 'Unable to protect that photo or video right now.');
      }

      const contentDisposition = response.headers.get('content-disposition');
      const downloadFileName = getFileNameFromContentDisposition(contentDisposition);
      const summaryHeader = response.headers.get('x-identik-summary');
      const summary = summaryHeader ? JSON.parse(summaryHeader) : null;
      const blob = await response.blob();
      const downloadUrl = URL.createObjectURL(blob);
      const summaryMediaType = summary?.media_type ?? summary?.mediaType;
      const defaultExt =
        summary?.mimeType?.startsWith('video/') || summaryMediaType === 'video' ? 'mp4' : 'jpg';
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download =
        downloadFileName ??
        (summary?.identik_name
          ? `protected-${summary.identik_name}.${defaultExt}`
          : `protected-${Date.now()}.${defaultExt}`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(downloadUrl);

      setStatus({
        kind: 'success',
        message: summary
          ? `All set! This photo or video is now protected under ${summary.identik_name}. ${
              summary.watermark_applied
                ? 'We added the subtle Identik watermark to your download.'
                : 'This download keeps the original pixels untouched.'
            }`
          : 'All set! This photo or video is now protected.'
      });
      setIdentikName(summary?.identik_name ?? identikNameValue);
      setIncludeWatermark(true);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (error) {
      setStatus({
        kind: 'error',
        message: error instanceof Error ? error.message : 'We could not protect that photo or video right now.'
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form ref={formRef} onSubmit={onSubmit} aria-label="Protect a photo or video">
      <div>
        <label htmlFor="protect-identik-name">
          Your Identik Name{' '}
          {claimedName && (
            <span className="status-pill success" style={{ marginLeft: '0.35rem' }}>
              Claimed
            </span>
          )}
        </label>
        <input
          id="protect-identik-name"
          name="identikName"
          type="text"
          placeholder="jenny.identik"
          value={identikName}
          onChange={(event) => setIdentikName(event.target.value)}
          readOnly={Boolean(claimedName)}
        />
        {nameStatus === 'loading' && session && <p className="form-helper">Loading your Identik Name…</p>}
        {nameStatus === 'error' && (
          <div className="status-banner status-danger" role="status">
            {nameError}
          </div>
        )}
        {claimedName && (
          <p className="form-helper">Auto-filled from your account. Each account uses one Identik Name.</p>
        )}
      </div>
      <div>
        <label htmlFor="protect-file">Photo or video to protect</label>
        <input id="protect-file" name="file" type="file" accept="image/*,video/*" ref={fileInputRef} />
      </div>
      <div className="watermark-toggle">
        <label htmlFor="protect-watermark" className="checkbox-row">
          <input
            id="protect-watermark"
            name="watermark"
            type="checkbox"
            checked={includeWatermark}
            onChange={(event) => setIncludeWatermark(event.target.checked)}
          />
          <span>Add the Identik shield watermark to this download</span>
        </label>
        <p className="form-helper">
          Uncheck if you prefer the untouched photo. Videos are always returned without a watermark. You can always rerun
          protect to grab the other version.
        </p>
      </div>
      <button type="submit" className="primary-btn" disabled={isSubmitting}>
        {isSubmitting ? 'Protecting…' : 'Protect this photo or video'}
      </button>
      {status && (
        <div className={statusToClass(status.kind)} role="status">
          {status.message}
        </div>
      )}
    </form>
  );
};

export default ProtectPhotoForm;
