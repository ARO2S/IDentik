import { createAnonSupabaseClient } from '@identik/database';
import { readFile } from 'node:fs/promises';
import { NextRequest } from 'next/server';
import { POST } from '../web/src/app/api/v1/sign/route';

process.env.SIGN_EMBED_TIMEOUT_MS = process.env.SIGN_EMBED_TIMEOUT_MS ?? '60000';
process.env.EXIFTOOL_TASK_TIMEOUT_MS = process.env.EXIFTOOL_TASK_TIMEOUT_MS ?? '60000';
process.env.SIGN_DEBUG = 'true';

async function main() {
  console.log('direct sign script: start');
  const supabase = createAnonSupabaseClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: process.env.SEED_DEMO_EMAIL ?? 'demo@identik.dev',
    password: process.env.SEED_DEMO_PASSWORD ?? 'identik-demo'
  });
  if (error || !data.session) {
    throw error ?? new Error('Unable to sign in demo user');
  }

  const accessToken = data.session.access_token;
  const buffer = await readFile('web/public/assets/IdentikShieldFilled.png');
  const formData = new FormData();
  formData.set('identikName', process.env.SEED_DEMO_IDENTIK_NAME ?? 'demo.identik');
  formData.set('file', new File([buffer], 'test.png', { type: 'image/png' }));

  const request = new NextRequest('http://localhost/api/v1/sign', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: formData
  });

  console.time('direct-sign');
  const response = await POST(request);
  console.timeEnd('direct-sign');
  console.log('status', response.status);
  console.log('headers', Object.fromEntries(response.headers.entries()));

  if (response.ok) {
    const arrayBuffer = await response.arrayBuffer();
    console.log('response-bytes', arrayBuffer.byteLength);
  } else {
    console.log('error-body', await response.text());
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
