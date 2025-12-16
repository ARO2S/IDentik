import exifParser from 'exif-parser';

export type DeviceMetadata = {
  device_make?: string;
  device_model?: string;
  software?: string;
  captured_at?: string;
};

const toCleanString = (value: unknown): string | undefined => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  return undefined;
};

const toIsoString = (value: unknown): string | undefined => {
  if (!value) return undefined;

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    // exif-parser returns epoch seconds for date fields
    return new Date(value * 1000).toISOString();
  }

  if (typeof value === 'string') {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return date.toISOString();
    }
  }

  return undefined;
};

/**
 * Extracts a safe, privacy-preserving subset of EXIF metadata that signals
 * whether the image came from a physical device. GPS, serial numbers, and other
 * identifiable fields are intentionally ignored.
 */
export const extractDeviceMetadata = (buffer: Buffer): DeviceMetadata | null => {
  try {
    const parser = exifParser.create(buffer);
    // Simple values gives strings/numbers instead of raw tag structures
    parser.enableSimpleValues(true);
    const result = parser.parse();
    const tags = result.tags ?? {};

    const device_make = toCleanString(tags.Make);
    const device_model = toCleanString(tags.Model);
    const software = toCleanString(tags.Software);
    const captured_at =
      toIsoString(tags.DateTimeOriginal) ??
      toIsoString(tags.CreateDate) ??
      toIsoString(tags.ModifyDate) ??
      undefined;

    const payload: DeviceMetadata = {};
    if (device_make) payload.device_make = device_make;
    if (device_model) payload.device_model = device_model;
    if (software) payload.software = software;
    if (captured_at) payload.captured_at = captured_at;

    return Object.keys(payload).length > 0 ? payload : null;
  } catch (error) {
    // Parsing failures should never block signing; just return null.
    console.warn('[deviceMetadata] Failed to read EXIF', error);
    return null;
  }
};

