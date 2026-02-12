export type ShareExpirePreset = '1d' | '7d' | '30d' | '1y' | 'never';

const DAY_MS = 24 * 60 * 60 * 1000;

const EXPIRE_PRESET_DAY_MAP: Record<Exclude<ShareExpirePreset, 'never'>, number> = {
  '1d': 1,
  '7d': 7,
  '30d': 30,
  '1y': 365,
};

export function getShareExpirePreset(expiresAt: string | null): ShareExpirePreset {
  if (!expiresAt) return 'never';

  const target = new Date(expiresAt);
  if (!Number.isFinite(target.getTime())) return '30d';

  const nowMs = Date.now();
  const diffDays = Math.max(0, (target.getTime() - nowMs) / DAY_MS);

  let nearestPreset: Exclude<ShareExpirePreset, 'never'> = '30d';
  let nearestGap = Number.POSITIVE_INFINITY;

  (Object.keys(EXPIRE_PRESET_DAY_MAP) as Array<Exclude<ShareExpirePreset, 'never'>>).forEach((preset) => {
    const gap = Math.abs(diffDays - EXPIRE_PRESET_DAY_MAP[preset]);
    if (gap < nearestGap) {
      nearestGap = gap;
      nearestPreset = preset;
    }
  });

  return nearestPreset;
}

export function buildExpiresAtByPreset(preset: ShareExpirePreset): string | null {
  if (preset === 'never') return null;

  const days = EXPIRE_PRESET_DAY_MAP[preset];
  const expiresAt = new Date(Date.now() + days * DAY_MS);
  return expiresAt.toISOString();
}

export function generateSharePassword(length = 4): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = '';

  for (let index = 0; index < length; index += 1) {
    const randomIndex = Math.floor(Math.random() * alphabet.length);
    result += alphabet[randomIndex];
  }

  return result;
}
