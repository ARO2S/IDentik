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
      try {
        const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://identik.dev';
        const logoUrl = `${appUrl}/assets/identik_logo_tagline_1000x500.svg`;
        const html = await renderVerificationEmail({ verificationUrl: url, logoUrl });
        const { error } = await resend.emails.send({
          from: process.env.RESEND_FROM_EMAIL!,
          to: user.email,
          subject: 'Verify your Identik email',
          html
        });
        if (error) throw new Error(`Resend send failed: ${error.message}`);
      } catch (err) {
        console.error('[better-auth] sendVerificationEmail failed:', err);
        throw err;
      }
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
