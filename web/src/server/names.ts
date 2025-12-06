const IDENTIK_SUFFIX = '.identik';
const LABEL_REGEX = /^[a-z0-9-]{3,32}$/;

export const sanitizeLabel = (input: string): string => {
  return input.trim().toLowerCase().replace(/\s+/g, '-');
};

export const normalizeIdentikName = (input: string): string => {
  const lower = input.trim().toLowerCase();
  if (lower.endsWith(IDENTIK_SUFFIX)) {
    return lower;
  }
  return `${lower}${IDENTIK_SUFFIX}`;
};

export const validateIdentikLabel = (label: string): boolean => {
  return LABEL_REGEX.test(label);
};

export const parseLabelFromName = (identikName: string): string => {
  const lower = identikName.toLowerCase();
  return lower.endsWith(IDENTIK_SUFFIX)
    ? lower.slice(0, lower.length - IDENTIK_SUFFIX.length)
    : lower;
};
