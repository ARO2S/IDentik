import sharp from 'sharp';
import type { CanonicalPayload } from '@identik/crypto-utils';

const IDENTIK_XMP_NS = 'https://identik.app/xmp/1.0/';
const EMBED_METADATA_ENABLED = process.env.EMBED_METADATA !== 'false';
const SIGN_DEBUG_ENABLED = process.env.SIGN_DEBUG === 'true';

const logMetadataDebug = (...args: unknown[]) => {
  if (SIGN_DEBUG_ENABLED) {
    console.info('[metadata]', ...args);
  }
};

export interface IdentikStamp {
  version: number;
  identik_name: string;
  payload_sha256: string;
  key_fingerprint: string;
  signature: string;
  signed_at: string;
}

export interface IdentikEmbeddedMetadata {
  identik_stamp: IdentikStamp;
  canonical_payload: CanonicalPayload;
}

export interface EmbedResult {
  buffer: Buffer;
  embedded: boolean;
  skippedReason?: string;
}

const escapeXml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const buildXmpPacket = (payload: IdentikEmbeddedMetadata): Buffer => {
  const json = JSON.stringify(payload);
  const escaped = escapeXml(json);
  const xmp = `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
           xmlns:identik="${IDENTIK_XMP_NS}"
           xmlns:dc="http://purl.org/dc/elements/1.1/">
    <rdf:Description rdf:about=""
        identik:payload="${escaped}">
      <dc:description>${escaped}</dc:description>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
  return Buffer.from(xmp, 'utf8');
};

const extractJsonFromXmp = (xmp?: Buffer | null): IdentikEmbeddedMetadata | null => {
  if (!xmp) return null;
  const text = xmp.toString('utf8');

  const attrMatch = text.match(/identik:payload="([^"]+)"/);
  const descMatch = text.match(/<dc:description>([^<]+)<\/dc:description>/);
  const candidate = attrMatch?.[1] ?? descMatch?.[1];
  if (!candidate) return null;

  const unescaped = candidate
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

  try {
    const parsed = JSON.parse(unescaped) as IdentikEmbeddedMetadata;
    if (!parsed?.identik_stamp || !parsed?.canonical_payload) return null;
    return parsed;
  } catch {
    return null;
  }
};

export const embedIdentikMetadata = async (
  buffer: Buffer,
  payload: IdentikEmbeddedMetadata
): Promise<EmbedResult> => {
  if (!EMBED_METADATA_ENABLED) {
    logMetadataDebug('embed_skipped', { reason: 'disabled_via_env' });
    return { buffer, embedded: false, skippedReason: 'disabled_via_env' };
  }

  try {
    const xmp = buildXmpPacket(payload);
    // Sharp's public types don't declare xmp, but it is supported at runtime.
    const result = await sharp(buffer).withMetadata({ xmp } as unknown as sharp.WriteableMetadata).toBuffer();
    logMetadataDebug('embed_sharp_complete', { bytes: result.length });
    return { buffer: result, embedded: true };
  } catch (error) {
    logMetadataDebug('embed_sharp_failed', {
      message: error instanceof Error ? error.message : String(error)
    });
    return { buffer, embedded: false, skippedReason: 'sharp_embed_failed' };
  }
};

export const extractIdentikMetadata = async (buffer: Buffer): Promise<IdentikEmbeddedMetadata | null> => {
  try {
    const meta = await sharp(buffer).metadata();
    return extractJsonFromXmp(meta.xmp ?? null);
  } catch (error) {
    logMetadataDebug('extract_failed', { message: error instanceof Error ? error.message : String(error) });
    return null;
  }
};

export const normalizeBufferForVerification = async (buffer: Buffer): Promise<Buffer> => {
  try {
    // Re-encode without withMetadata(), which strips XMP/EXIF by default.
    const normalized = await sharp(buffer).toBuffer();
    logMetadataDebug('normalize_sharp_complete', { bytes: normalized.length });
    return normalized;
  } catch (error) {
    logMetadataDebug('normalize_sharp_failed', { message: error instanceof Error ? error.message : String(error) });
    return buffer;
  }
};
