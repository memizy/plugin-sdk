import type { MediaObject } from '@memizy/oqse';

const ABSOLUTE_SCHEME_RE = /^(https?|data|blob):/i;

function resolveAssetRecord(
  assets: Record<string, MediaObject>,
  baseUrl: URL,
): void {
  for (const key of Object.keys(assets)) {
    const asset = assets[key];
    if (
      asset &&
      typeof asset === 'object' &&
      typeof asset.value === 'string' &&
      !ABSOLUTE_SCHEME_RE.test(asset.value)
    ) {
      asset.value = new URL(asset.value, baseUrl).href;
    }
  }
}

/**
 * Mutates a parsed OQSE payload in place: relative `assets[*].value` strings
 * become absolute URLs against `jsonUrl` (the fetched JSON document URL).
 */
export function resolveRelativeOqseAssetUrls(
  payload: unknown,
  jsonUrl: string,
): void {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return;

  const baseUrl = new URL(jsonUrl);
  const root = payload as Record<string, unknown>;

  const meta = root['meta'];
  if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
    const assets = (meta as Record<string, unknown>)['assets'];
    if (assets && typeof assets === 'object' && !Array.isArray(assets)) {
      resolveAssetRecord(assets as Record<string, MediaObject>, baseUrl);
    }
  }

  const topAssets = root['assets'];
  if (topAssets && typeof topAssets === 'object' && !Array.isArray(topAssets)) {
    resolveAssetRecord(topAssets as Record<string, MediaObject>, baseUrl);
  }
}
