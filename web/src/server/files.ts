export const fileToBuffer = async (file: File): Promise<Buffer> => {
  const arrayBuffer = await file.arrayBuffer();
  return Buffer.from(arrayBuffer);
};

export const getSafeFileName = (file: File | null, fallbackExt = 'jpg'): string => {
  const name = file?.name?.trim();
  if (name) {
    return name.replace(/[^a-zA-Z0-9._-]/g, '_');
  }
  return `photo-${Date.now()}.${fallbackExt}`;
};

export const appendSuffixToFileName = (fileName: string, suffix: string): string => {
  if (!suffix) {
    return fileName;
  }

  const lastDotIndex = fileName.lastIndexOf('.');
  if (lastDotIndex <= 0 || lastDotIndex === fileName.length - 1) {
    return `${fileName}${suffix}`;
  }

  const baseName = fileName.slice(0, lastDotIndex);
  const extension = fileName.slice(lastDotIndex);
  return `${baseName}${suffix}${extension}`;
};
