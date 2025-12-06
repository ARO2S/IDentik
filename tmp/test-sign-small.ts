import { createAnonSupabaseClient } from '@identik/database';
import { readFile } from 'node:fs/promises';

async function main() {
  console.log('small sign script: start');
  const supabase = createAnonSupabaseClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: process.env.SEED_DEMO_EMAIL ?? 'demo@identik.dev',
    password: process.env.SEED_DEMO_PASSWORD ?? 'identik-demo'
  });
  if (error || !data.session) {
    throw error ?? new Error('Unable to sign in demo user');
  }

  const accessToken = data.session.access_token;
  const buffer = await readFile('web/public/assets/identik_icon_shield_64.png');
  const formData = new FormData();
  formData.set('identikName', process.env.SEED_DEMO_IDENTIK_NAME ?? 'demo.identik');
  formData.set('file', new Blob([buffer], { type: 'image/png' }), 'small.png');

  const targetUrl = process.env.SIGN_API_URL ?? 'http://localhost:3000/api/v1/sign';
  console.time('small-sign-request');
  const response = await fetch(targetUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: formData
  });
  console.timeEnd('small-sign-request');
  console.log('status', response.status);
  const headers = Object.fromEntries(response.headers.entries());
  console.log('headers', headers);
  if (response.ok) {
    const blob = await response.blob();
    console.log('blob size', blob.size);
  } else {
    console.log('body', await response.text());
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
