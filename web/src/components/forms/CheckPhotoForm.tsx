'use client';

import { useRef, useState } from 'react';

type VerifyResponse = {
  verified: boolean;
  score: number;
  identik_name?: string | null;
  label: 'Trusted' | 'Limited history' | 'Warning' | 'Not protected';
  message: string;
  details?: {
    domain_reputation: number | null;
    checks: string[];
    warnings: string[];
    signer_activity?: {
      totalSigned: number;
      reportCount: number;
      reportRatio: number;
    };
    domain_age_days?: number;
  };
  reporting?: {
    identik_name: string;
    payload_hash: string;
    media_id: string | null;
    domain_id: string;
  };
};

const statusToClass = (label: VerifyResponse['label']) => {
  switch (label) {
    case 'Trusted':
      return 'status-banner status-success';
    case 'Limited history':
      return 'status-banner status-caution';
    case 'Warning':
      return 'status-banner status-caution';
    default:
      return 'status-banner status-danger';
  }
};

export const CheckPhotoForm = () => {
  const formRef = useRef<HTMLFormElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [result, setResult] = useState<VerifyResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reportStatus, setReportStatus] = useState<string | null>(null);
  const [isReporting, setIsReporting] = useState(false);

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setResult(null);
    setError(null);
    setReportStatus(null);

    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setError('Please select a photo or video to check.');
      return;
    }

    const formData = new FormData();
    formData.append('file', file);

    setIsChecking(true);
    try {
      const response = await fetch('/api/v1/verify', {
        method: 'POST',
        body: formData
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error ?? 'Unable to check that photo or video right now.');
      }

      setResult(data as VerifyResponse);
      formRef.current?.reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'We could not check that photo or video.');
    } finally {
      setIsChecking(false);
    }
  };

  const onReport = async () => {
    if (!result?.reporting) {
      return;
    }
    setIsReporting(true);
    setReportStatus(null);
    try {
      const response = await fetch('/api/v1/verify/report', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(result.reporting)
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error ?? 'We could not file that report.');
      }

      setReportStatus('Thanks for flagging this photo or video. Our trust signals will reflect your report.');
    } catch (err) {
      setReportStatus(err instanceof Error ? err.message : 'We could not file that report.');
    } finally {
      setIsReporting(false);
    }
  };

  return (
    <form ref={formRef} onSubmit={onSubmit} aria-label="Check a photo or video">
      <div>
        <label htmlFor="check-file">Photo or video to check</label>
        <input id="check-file" name="file" type="file" accept="image/*,video/*" ref={fileInputRef} />
      </div>
      <button type="submit" className="primary-btn" disabled={isChecking}>
        {isChecking ? 'Checking…' : 'Check this photo or video'}
      </button>

      {error && (
        <div className="status-banner status-danger" role="status">
          {error}
        </div>
      )}

      {result && (
        <div className={statusToClass(result.label)} role="status">
          <div>
            <strong>{result.label}</strong>
            <p style={{ margin: '0.35rem 0 0' }}>{result.message}</p>
            {result.identik_name && (
              <p style={{ margin: '0.35rem 0 0', fontSize: '0.9rem' }}>
                Identik Name: <strong>{result.identik_name}</strong>
              </p>
            )}
            <p style={{ margin: '0.35rem 0 0', fontSize: '0.85rem' }}>Score: {(result.score * 100).toFixed(0)}%</p>
            {result.details && result.details.checks.length > 0 && (
              <ul style={{ marginTop: '0.5rem' }}>
                {result.details.checks.map((check) => (
                  <li key={check}>{check}</li>
                ))}
              </ul>
            )}
            {result.details && result.details.warnings.length > 0 && (
              <ul style={{ marginTop: '0.5rem', color: 'var(--danger-red)' }}>
                {result.details.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            )}
            {result.reporting && (
              <div style={{ marginTop: '0.75rem' }}>
                <button type="button" className="report-btn" onClick={onReport} disabled={isReporting}>
                  {isReporting ? 'Sending report…' : 'Report as AI'}
                </button>
                {reportStatus && (
                  <p style={{ marginTop: '0.4rem', fontSize: '0.85rem' }}>{reportStatus}</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </form>
  );
};

export default CheckPhotoForm;
