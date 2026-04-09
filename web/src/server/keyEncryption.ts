import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

function getEncryptionKey(): Buffer {
  const secret = process.env.SIGNING_KEY_ENCRYPTION_SECRET;
  if (!secret) {
    throw new Error('SIGNING_KEY_ENCRYPTION_SECRET is not set.');
  }
  const key = Buffer.from(secret, 'hex');
  if (key.length !== KEY_BYTES) {
    throw new Error(
      'SIGNING_KEY_ENCRYPTION_SECRET must be exactly 32 bytes (64 hex characters).'
    );
  }
  return key;
}

/**
 * Encrypts a private key hex string.
 * Returns: hex-encoded iv (12 bytes) + auth tag (16 bytes) + ciphertext.
 */
export function encryptPrivateKey(privateKeyHex: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const plaintext = Buffer.from(privateKeyHex, 'utf8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('hex');
}

/**
 * Decrypts an encrypted private key produced by encryptPrivateKey.
 * Returns the original private key hex string.
 */
export function decryptPrivateKey(encryptedHex: string): string {
  const key = getEncryptionKey();
  const data = Buffer.from(encryptedHex, 'hex');
  const iv = data.subarray(0, IV_BYTES);
  const tag = data.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = data.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
