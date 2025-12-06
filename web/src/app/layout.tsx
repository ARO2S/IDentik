import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import SupabaseProvider from '@/components/providers/SupabaseProvider';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter'
});

export const metadata: Metadata = {
  title: 'Identik – Trusted identity for trusted media',
  description: 'Protect and verify photos with a simple Identik Name.',
  icons: {
    icon: [
      { url: '/assets/favicon-32.png', type: 'image/png', sizes: '32x32' },
      { url: '/assets/favicon-16.png', type: 'image/png', sizes: '16x16' }
    ],
    apple: [{ url: '/assets/apple-touch-icon-180.svg', sizes: '180x180' }],
    shortcut: ['/assets/identik_icon_shield_64.png'],
    other: [{ rel: 'mask-icon', url: '/assets/identik_icon_shield_128.svg', color: '#0d1b2a' }]
  }
};

export default function RootLayout({
  children
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${inter.variable} page-shell`}>
        <SupabaseProvider>{children}</SupabaseProvider>
      </body>
    </html>
  );
}
