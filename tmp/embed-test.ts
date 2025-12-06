import { readFile } from 'node:fs/promises';
import { embedIdentikMetadata, type IdentikEmbeddedMetadata } from '../web/src/server/metadata';

async function main() {
  const buffer = await readFile('web/public/assets/identik_icon_shield_64.png');

  const embedded: IdentikEmbeddedMetadata = {
    identik_stamp: {
      version: 1,
      identik_name: 'demo.identik',
      payload_sha256: 'test-payload',
      key_fingerprint: 'test-fingerprint',
      signature: 'test-signature',
      signed_at: new Date().toISOString()
    },
    canonical_payload: {
      version: 1,
      identik_name: 'demo.identik',
      file_sha256: 'test-file',
      metadata: {},
      timestamp: new Date().toISOString()
    }
  };

  console.time('embed-small');
  const result = await embedIdentikMetadata(buffer, embedded);
  console.timeEnd('embed-small');
  console.log('embedded-bytes', result.length);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
