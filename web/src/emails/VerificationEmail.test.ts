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
