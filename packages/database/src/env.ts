const required = (value: string | undefined, message: string) => {
  if (!value || value.length === 0) {
    throw new Error(message);
  }
  return value;
};

export const getDatabaseUrl = () => {
  const fallback = process.env.SUPABASE_DB_URL ?? process.env.DIRECT_DATABASE_URL;
  const databaseUrl = process.env.DATABASE_URL ?? fallback;
  return required(databaseUrl, 'Set DATABASE_URL (or SUPABASE_DB_URL) in your environment');
};

export const getSupabaseUrl = () => required(process.env.SUPABASE_URL, 'Set SUPABASE_URL in your environment');

export const getSupabaseAnonKey = () => required(process.env.SUPABASE_ANON_KEY, 'Set SUPABASE_ANON_KEY in your environment');

export const getSupabaseServiceRoleKey = () =>
  required(process.env.SUPABASE_SERVICE_ROLE_KEY, 'Set SUPABASE_SERVICE_ROLE_KEY in your environment');
