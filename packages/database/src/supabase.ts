import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAnonKey, getSupabaseServiceRoleKey, getSupabaseUrl } from './env.js';

const createSupabaseClient = (key: string): SupabaseClient => {
  return createClient(getSupabaseUrl(), key, {
    auth: {
      persistSession: false
    }
  });
};

export const createServiceSupabaseClient = (): SupabaseClient => {
  return createSupabaseClient(getSupabaseServiceRoleKey());
};

export const createAnonSupabaseClient = (): SupabaseClient => {
  return createSupabaseClient(getSupabaseAnonKey());
};
