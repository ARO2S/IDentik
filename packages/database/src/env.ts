const required = (value: string | undefined, message: string) => {
  if (!value || value.length === 0) {
    throw new Error(message);
  }
  return value;
};

export const getDatabaseUrl = () =>
  required(process.env.DATABASE_URL, 'Set DATABASE_URL in your environment');
