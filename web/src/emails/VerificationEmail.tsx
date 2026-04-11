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
  // Throws TypeError if verificationUrl is malformed — fail loudly rather than deliver a broken link
  new URL(props.verificationUrl);
  return render(<VerificationEmail {...props} />);
};

export default VerificationEmail;
