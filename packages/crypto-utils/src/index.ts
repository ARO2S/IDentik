import { etc, getPublicKey, sign, verify } from '@noble/ed25519';
import { sha256, sha512 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';

etc.sha512Sync ??= (msg) => sha512(msg);

export const IDENTIK_PAYLOAD_VERSION = 1 as const;

type StringRecord = Record<string, unknown>;

export interface CanonicalPayload {
  version: number;
  identik_name: string;
  file_sha256: string;
  metadata: StringRecord;
  timestamp: string;
}

export interface CanonicalPayloadInput {
  identikName: string;
  fileSha256: string;
  metadata?: StringRecord;
  timestamp?: Date | string;
  version?: number;
}

const normalizeTimestamp = (timestamp?: Date | string): string => {
  if (!timestamp) {
    return new Date().toISOString();
  }

  if (timestamp instanceof Date) {
    return timestamp.toISOString();
  }

  return new Date(timestamp).toISOString();
};

const sortMetadata = (metadata: StringRecord = {}): StringRecord => {
  return Object.keys(metadata)
    .sort((a, b) => a.localeCompare(b))
    .reduce<StringRecord>((acc, key) => {
      acc[key] = metadata[key];
      return acc;
    }, {});
};

const toBase64 = (value: Uint8Array): string => {
  if (typeof globalThis.Buffer !== 'undefined') {
    return globalThis.Buffer.from(value).toString('base64');
  }

  if (typeof btoa === 'function') {
    let result = '';
    value.forEach((byte) => {
      result += String.fromCharCode(byte);
    });
    return btoa(result);
  }

  throw new Error('Base64 encoding is not supported in this environment.');
};

const fromBase64 = (value: string): Uint8Array => {
  if (typeof globalThis.Buffer !== 'undefined') {
    return new Uint8Array(globalThis.Buffer.from(value, 'base64'));
  }

  if (typeof atob === 'function') {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  throw new Error('Base64 decoding is not supported in this environment.');
};

export const createCanonicalPayload = (input: CanonicalPayloadInput): CanonicalPayload => {
  const payload: CanonicalPayload = {
    version: input.version ?? IDENTIK_PAYLOAD_VERSION,
    identik_name: input.identikName.toLowerCase(),
    file_sha256: input.fileSha256,
    metadata: sortMetadata(input.metadata ?? {}),
    timestamp: normalizeTimestamp(input.timestamp)
  };

  return payload;
};

export const serializeCanonicalPayload = (payload: CanonicalPayload): string => {
  return JSON.stringify(payload);
};

export const sha256Hex = (input: string | Uint8Array): string => {
  const source = typeof input === 'string' ? utf8ToBytes(input) : input;
  return bytesToHex(sha256(source));
};

export const fingerprintPayload = (payload: CanonicalPayload): string => {
  return sha256Hex(serializeCanonicalPayload(payload));
};

export const fingerprintPublicKey = (publicKeyHex: string): string => {
  return sha256Hex(hexToBytes(publicKeyHex));
};

export const signPayload = async (payloadHex: string, privateKeyHex: string): Promise<string> => {
  const payloadBytes = hexToBytes(payloadHex);
  const privateKeyBytes = hexToBytes(privateKeyHex);
  const signature = await sign(payloadBytes, privateKeyBytes);
  return toBase64(signature);
};

export const verifyPayload = async (
  payloadHex: string,
  signatureBase64: string,
  publicKeyHex: string
): Promise<boolean> => {
  const payloadBytes = hexToBytes(payloadHex);
  const signatureBytes = fromBase64(signatureBase64);
  const publicKeyBytes = hexToBytes(publicKeyHex);
  return verify(signatureBytes, payloadBytes, publicKeyBytes);
};

export const derivePublicKey = async (privateKeyHex: string): Promise<string> => {
  const privateKeyBytes = hexToBytes(privateKeyHex);
  const publicKey = await getPublicKey(privateKeyBytes);
  return bytesToHex(publicKey);
};

export const canonicalPayloadHash = (payload: CanonicalPayload): string => {
  return fingerprintPayload(payload);
};

