import type { CanonicalPayload } from '@identik/crypto-utils';

const IDENTIK_XMP_NS = 'https://identik.app/xmp/1.0/';
const XMP_HEADER = Buffer.from('http://ns.adobe.com/xap/1.0\u0000', 'ascii');
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_XMP_KEYWORD = 'XML:com.adobe.xmp';
const EMBED_METADATA_ENABLED = process.env.EMBED_METADATA !== 'false';
const SIGN_DEBUG_ENABLED = process.env.SIGN_DEBUG === 'true';
const IDENTIK_MP4_UUID = Buffer.from('f316c0b405c14c56a5ad597240fdfd1f', 'hex');

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

const isJpeg = (buffer: Buffer) => buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8;
const isPng = (buffer: Buffer) => buffer.length > 8 && buffer.subarray(0, 8).equals(PNG_SIGNATURE);
const isMp4Like = (buffer: Buffer) =>
  buffer.length > 12 && buffer.subarray(4, 8).toString('ascii') === 'ftyp';

const appendJpegXmpSegment = (jpeg: Buffer, xmpPacket: Buffer): Buffer => {
  // APP1 segment: marker FFE1, length (2 bytes, includes length bytes), followed by header + XMP.
  const payloadLength = XMP_HEADER.length + xmpPacket.length;
  const segmentLength = payloadLength + 2; // length field counts payload only, not marker
  const segment = Buffer.alloc(2 + 2 + payloadLength);
  segment[0] = 0xff;
  segment[1] = 0xe1;
  segment.writeUInt16BE(segmentLength, 2);
  XMP_HEADER.copy(segment, 4);
  xmpPacket.copy(segment, 4 + XMP_HEADER.length);

  // Insert immediately after SOI (first two bytes)
  const soi = jpeg.subarray(0, 2);
  const rest = jpeg.subarray(2);
  return Buffer.concat([soi, segment, rest]);
};

const stripIdentikXmpSegment = (jpeg: Buffer): { buffer: Buffer; stripped: boolean } => {
  if (!isJpeg(jpeg)) return { buffer: jpeg, stripped: false };
  const parts: Buffer[] = [];
  let offset = 0;
  let stripped = false;

  // Keep SOI
  parts.push(jpeg.subarray(0, 2));
  offset = 2;

  while (offset + 4 <= jpeg.length) {
    if (jpeg[offset] !== 0xff) break;
    const marker = jpeg[offset + 1];
    offset += 2;

    // Standalone markers without length
    if (marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      parts.push(jpeg.subarray(offset - 2));
      break;
    }

    if (offset + 2 > jpeg.length) break;
    const len = jpeg.readUInt16BE(offset);
    const segmentStart = offset - 2;
    const segmentEnd = offset + len;
    const segmentBody = jpeg.subarray(offset + 2, segmentEnd);
    offset = segmentEnd;

    const isXmpApp1 = marker === 0xe1 && segmentBody.subarray(0, XMP_HEADER.length).equals(XMP_HEADER);
    if (isXmpApp1) {
      stripped = true;
      continue; // drop this segment
    }

    parts.push(jpeg.subarray(segmentStart, segmentEnd));
  }

  return { buffer: Buffer.concat(parts), stripped };
};

const extractXmpFromJpeg = (jpeg: Buffer): Buffer | null => {
  if (!isJpeg(jpeg)) return null;
  let offset = 2; // after SOI

  while (offset + 4 <= jpeg.length) {
    if (jpeg[offset] !== 0xff) break;
    const marker = jpeg[offset + 1];
    offset += 2;

    if (marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      break;
    }

    if (offset + 2 > jpeg.length) break;
    const len = jpeg.readUInt16BE(offset);
    const segmentStart = offset + 2;
    const segmentEnd = offset + len;
    const segmentBody = jpeg.subarray(segmentStart, segmentEnd);
    offset = segmentEnd;

    const isXmpApp1 = marker === 0xe1 && segmentBody.subarray(0, XMP_HEADER.length).equals(XMP_HEADER);
    if (isXmpApp1) {
      return segmentBody.subarray(XMP_HEADER.length);
    }
  }

  return null;
};

const crc32Table = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) === 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

const crc32 = (buffer: Buffer): number => {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = crc32Table[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const buildPngChunk = (type: string, data: Buffer): Buffer => {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  const crcInput = Buffer.concat([typeBuf, data]);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
};

const buildPngXmpChunkData = (xmpPacket: Buffer): Buffer => {
  const keyword = Buffer.from(PNG_XMP_KEYWORD, 'utf8');
  const nul = Buffer.from([0]);
  const compressionFlag = Buffer.from([0]); // 0 = uncompressed
  const compressionMethod = Buffer.from([0]);
  const languageTag = nul;
  const translatedKeyword = nul;
  return Buffer.concat([
    keyword,
    nul,
    compressionFlag,
    compressionMethod,
    languageTag,
    translatedKeyword,
    xmpPacket
  ]);
};

const appendPngXmpChunk = (png: Buffer, xmpPacket: Buffer): Buffer => {
  if (!isPng(png)) return png;
  // Strip existing Identik XMP chunk, then insert a new one after IHDR.
  const { chunks, stripped } = stripIdentikPngXmpChunks(png);
  const resultChunks: Buffer[] = [];
  // Signature
  resultChunks.push(PNG_SIGNATURE);
  let inserted = false;
  for (const chunk of chunks) {
    resultChunks.push(chunk.raw);
    if (!inserted && chunk.type === 'IHDR') {
      const data = buildPngXmpChunkData(xmpPacket);
      resultChunks.push(buildPngChunk('iTXt', data));
      inserted = true;
    }
  }
  if (!inserted) {
    const data = buildPngXmpChunkData(xmpPacket);
    resultChunks.push(buildPngChunk('iTXt', data));
  }
  logMetadataDebug('png_embed', { strippedExisting: stripped });
  return Buffer.concat(resultChunks);
};

const stripIdentikPngXmpChunks = (
  png: Buffer
): { buffer: Buffer; stripped: boolean; chunks: Array<{ type: string; data: Buffer; raw: Buffer }> } => {
  if (!isPng(png)) return { buffer: png, stripped: false, chunks: [] };
  const chunks: Array<{ type: string; data: Buffer; raw: Buffer }> = [];
  let offset = 8;
  let stripped = false;
  while (offset + 8 <= png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.subarray(offset + 4, offset + 8).toString('ascii');
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const crcEnd = dataEnd + 4;
    if (crcEnd > png.length) break;
    const data = png.subarray(dataStart, dataEnd);
    const raw = png.subarray(offset, crcEnd);
    const isIdentikXmp =
      type === 'iTXt' &&
      data.subarray(0, PNG_XMP_KEYWORD.length).toString('utf8') === PNG_XMP_KEYWORD &&
      data[PNG_XMP_KEYWORD.length] === 0; // null terminator
    if (isIdentikXmp) {
      stripped = true;
    } else {
      chunks.push({ type, data, raw });
    }
    offset = crcEnd;
    if (type === 'IEND') break;
  }
  const rebuilt = Buffer.concat([PNG_SIGNATURE, ...chunks.map((c) => c.raw)]);
  return { buffer: rebuilt, stripped, chunks };
};

const extractXmpFromPng = (png: Buffer): Buffer | null => {
  if (!isPng(png)) return null;
  let offset = 8;
  while (offset + 8 <= png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.subarray(offset + 4, offset + 8).toString('ascii');
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const crcEnd = dataEnd + 4;
    if (crcEnd > png.length) break;
    const data = png.subarray(dataStart, dataEnd);
    offset = crcEnd;
    if (
      type === 'iTXt' &&
      data.subarray(0, PNG_XMP_KEYWORD.length).toString('utf8') === PNG_XMP_KEYWORD &&
      data[PNG_XMP_KEYWORD.length] === 0
    ) {
      // iTXt layout: keyword\0 compressionFlag(1)\0 compressionMethod(1)\0 language\0 translated\0 text
      // keyword + 1 (nul) + 1 (flag) + 1 (method) + at least 2 nuls => find the last two nuls sequence
      let cursor = PNG_XMP_KEYWORD.length + 1; // after keyword nul
      if (cursor + 2 > data.length) break;
      const compressionFlag = data[cursor];
      cursor += 1; // flag
      cursor += 1; // compression method
      // language tag (null-terminated)
      while (cursor < data.length && data[cursor] !== 0) cursor += 1;
      cursor += 1; // null
      while (cursor < data.length && data[cursor] !== 0) cursor += 1;
      cursor += 1; // null
      const text = data.subarray(cursor);
      if (compressionFlag === 0) {
        return text;
      }
      return null; // compressed not supported here
    }
    if (type === 'IEND') break;
  }
  return null;
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

const buildIdentikMp4UuidBox = (payload: IdentikEmbeddedMetadata): Buffer => {
  const data = Buffer.from(JSON.stringify(payload), 'utf8');
  const size = 4 + 4 + 16 + data.length; // size + type + uuid + payload
  const header = Buffer.alloc(4 + 4 + 16);
  header.writeUInt32BE(size, 0);
  header.write('uuid', 4, 'ascii');
  IDENTIK_MP4_UUID.copy(header, 8);
  return Buffer.concat([header, data]);
};

type Mp4BoxHandler = (ctx: {
  type: string;
  size: number;
  headerSize: number;
  uuidOffset?: number;
  dataOffset: number;
  dataEnd: number;
}) => boolean | void;

const walkMp4Boxes = (buffer: Buffer, onBox: Mp4BoxHandler) => {
  let offset = 0;
  const len = buffer.length;

  while (offset + 8 <= len) {
    const size32 = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    let size = size32;
    let headerSize = 8;

    if (size === 1) {
      if (offset + 16 > len) break;
      const largeSize = Number(buffer.readBigUInt64BE(offset + 8));
      size = largeSize;
      headerSize = 16;
    } else if (size === 0) {
      size = len - offset;
    }

    if (size < headerSize || offset + size > len || size === 0) {
      break;
    }

    const isUuid = type === 'uuid';
    const uuidOffset = isUuid ? offset + headerSize : undefined;
    const dataOffset = isUuid ? offset + headerSize + 16 : offset + headerSize;
    const dataEnd = offset + size;
    const totalHeader = isUuid ? headerSize + 16 : headerSize;

    const shouldStop = onBox({
      type,
      size,
      headerSize: totalHeader,
      uuidOffset,
      dataOffset,
      dataEnd
    });
    if (shouldStop) {
      return;
    }

    offset = dataEnd;
  }
};

const appendIdentikMp4Box = (mp4: Buffer, payload: IdentikEmbeddedMetadata): Buffer => {
  const box = buildIdentikMp4UuidBox(payload);
  // Appending an unknown UUID box at the end is valid for ISO BMFF/MP4 and keeps
  // existing structure untouched.
  return Buffer.concat([mp4, box]);
};

const stripIdentikMp4Boxes = (mp4: Buffer): { buffer: Buffer; stripped: boolean } => {
  if (!isMp4Like(mp4)) return { buffer: mp4, stripped: false };
  const parts: Buffer[] = [];
  let stripped = false;

  walkMp4Boxes(mp4, ({ type, uuidOffset, dataOffset, dataEnd, headerSize }) => {
    if (type === 'uuid' && uuidOffset !== undefined) {
      const uuid = mp4.subarray(uuidOffset, uuidOffset + 16);
      if (uuid.equals(IDENTIK_MP4_UUID)) {
        stripped = true;
        return; // skip this box
      }
    }
    const boxStart = dataOffset - headerSize;
    parts.push(mp4.subarray(boxStart, dataEnd));
  });

  const rebuilt = parts.length > 0 ? Buffer.concat(parts) : mp4;
  return { buffer: rebuilt, stripped };
};

const extractIdentikFromMp4 = (mp4: Buffer): IdentikEmbeddedMetadata | null => {
  if (!isMp4Like(mp4)) return null;
  let found: IdentikEmbeddedMetadata | null = null;

  walkMp4Boxes(mp4, ({ type, uuidOffset, dataOffset, dataEnd }) => {
    if (type !== 'uuid' || uuidOffset === undefined) return;
    const uuid = mp4.subarray(uuidOffset, uuidOffset + 16);
    if (!uuid.equals(IDENTIK_MP4_UUID)) return;
    const data = mp4.subarray(dataOffset, dataEnd);
    try {
      const parsed = JSON.parse(data.toString('utf8')) as IdentikEmbeddedMetadata;
      if (parsed?.identik_stamp && parsed?.canonical_payload) {
        found = parsed;
        return true; // stop walking
      }
    } catch {
      // ignore malformed content
    }
    return;
  });

  return found;
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
    if (isJpeg(buffer)) {
      const result = appendJpegXmpSegment(buffer, xmp);
      logMetadataDebug('embed_jpeg_complete', { bytes: result.length });
      return { buffer: result, embedded: true };
    }
    if (isPng(buffer)) {
      const result = appendPngXmpChunk(buffer, xmp);
      logMetadataDebug('embed_png_complete', { bytes: result.length });
      return { buffer: result, embedded: true };
    }
    if (isMp4Like(buffer)) {
      const result = appendIdentikMp4Box(buffer, payload);
      logMetadataDebug('embed_mp4_complete', { bytes: result.length });
      return { buffer: result, embedded: true };
    }
    logMetadataDebug('embed_skipped', { reason: 'unsupported_format' });
    return { buffer, embedded: false, skippedReason: 'unsupported_format' };
  } catch (error) {
    logMetadataDebug('embed_failed', { message: error instanceof Error ? error.message : String(error) });
    return { buffer, embedded: false, skippedReason: 'embed_failed' };
  }
};

export const extractIdentikMetadata = async (buffer: Buffer): Promise<IdentikEmbeddedMetadata | null> => {
  if (isMp4Like(buffer)) {
    const parsed = extractIdentikFromMp4(buffer);
    if (!parsed) {
      logMetadataDebug('extract_failed_parse', {});
    }
    return parsed;
  }

  const xmp = isJpeg(buffer) ? extractXmpFromJpeg(buffer) : isPng(buffer) ? extractXmpFromPng(buffer) : null;
  const parsed = extractJsonFromXmp(xmp);
  if (!parsed && xmp) {
    logMetadataDebug('extract_failed_parse', {});
  }
  return parsed;
};

export const normalizeBufferForVerification = async (buffer: Buffer): Promise<Buffer> => {
  if (isMp4Like(buffer)) {
    const { buffer: stripped, stripped: didStrip } = stripIdentikMp4Boxes(buffer);
    if (didStrip) {
      logMetadataDebug('normalize_stripped_mp4_box', {
        originalBytes: buffer.length,
        strippedBytes: stripped.length
      });
    }
    return stripped;
  }
  if (isJpeg(buffer)) {
    const { buffer: stripped, stripped: didStrip } = stripIdentikXmpSegment(buffer);
    if (didStrip) {
      logMetadataDebug('normalize_stripped_xmp_jpeg', {
        originalBytes: buffer.length,
        strippedBytes: stripped.length
      });
    }
    return stripped;
  }
  if (isPng(buffer)) {
    const { buffer: stripped, stripped: didStrip } = stripIdentikPngXmpChunks(buffer);
    if (didStrip) {
      logMetadataDebug('normalize_stripped_xmp_png', {
        originalBytes: buffer.length,
        strippedBytes: stripped.length
      });
    }
    return stripped;
  }
  return buffer;
};
