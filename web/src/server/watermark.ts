import path from 'node:path';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';

const WATERMARK_ASSET_PATH = path.join(
  process.cwd(),
  'public',
  'assets',
  'identik_icon_shield_64.svg'
);

const svgCache: { raw?: Buffer; variants: Map<number, Buffer> } = {
  raw: undefined,
  variants: new Map()
};

const WATERMARK_COLOR = { r: 148, g: 152, b: 161 };
const WATERMARK_LAYOUT = {
  relativeMargin: 0.022,
  minMarginPx: 16,
  relativeWidth: 0.12,
  minWidthPx: 48,
  maxWidthPx: 200,
  opacity: 0.65
};

const loadRawWatermark = async (): Promise<Buffer> => {
  if (!svgCache.raw) {
    svgCache.raw = await readFile(WATERMARK_ASSET_PATH);
  }
  return svgCache.raw;
};

const getSizedOverlay = async (width: number): Promise<Buffer> => {
  const cached = svgCache.variants.get(width);
  if (cached) {
    return cached;
  }

  const raw = await loadRawWatermark();
  const rendered = await sharp(raw)
    .resize({ width, fit: 'contain' })
    .tint(WATERMARK_COLOR)
    .modulate({ saturation: 0.15, brightness: 0.92 })
    .ensureAlpha()
    .toBuffer();

  svgCache.variants.set(width, rendered);
  return rendered;
};

export const applyIdentikWatermark = async (buffer: Buffer): Promise<Buffer> => {
  try {
    const metadata = await sharp(buffer).metadata();
    const width = metadata.width ?? 1024;
    const height = metadata.height ?? 1024;
    const longestEdge = Math.max(width, height);

    const margin = Math.round(
      Math.max(longestEdge * WATERMARK_LAYOUT.relativeMargin, WATERMARK_LAYOUT.minMarginPx)
    );
    const overlayWidth = Math.round(
      Math.min(
        Math.max(width * WATERMARK_LAYOUT.relativeWidth, WATERMARK_LAYOUT.minWidthPx),
        WATERMARK_LAYOUT.maxWidthPx
      )
    );
    const overlay = await getSizedOverlay(overlayWidth);

    return await sharp(buffer)
      .composite([
        {
          input: overlay,
          top: margin,
          left: margin,
          blend: 'over',
          opacity: WATERMARK_LAYOUT.opacity
        }
      ])
      .toBuffer();
  } catch (error) {
    console.error('[watermark] Failed to apply watermark', error);
    return buffer;
  }
};
