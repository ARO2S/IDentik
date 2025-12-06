'use client';

import { SessionContextProvider } from '@supabase/auth-helpers-react';
import { createBrowserSupabaseClient } from '@supabase/auth-helpers-nextjs';
import { useState, type ReactNode } from 'react';

export const SupabaseProvider = ({ children }: { children: ReactNode }) => {
  const [supabaseClient] = useState(() => createBrowserSupabaseClient());

  return <SessionContextProvider supabaseClient={supabaseClient}>{children}</SessionContextProvider>;
};

export default SupabaseProvider;
