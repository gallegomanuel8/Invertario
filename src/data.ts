import raw from './data/funds.json';
import type { Catalog, Product } from './types';

export const catalog = raw as Catalog;

export const NEW_DAYS = 30;

export function isNew(p: Product, now = Date.now()) {
  if (!p.addedAt) return false;
  return now - new Date(p.addedAt).getTime() < NEW_DAYS * 86_400_000;
}

export const byIsin = new Map(catalog.items.filter((p) => p.isin).map((p) => [p.isin!, p]));

export function productLink(p: Product) {
  if (p.type === 'etf') return `https://www.justetf.com/es/etf-profile.html?isin=${p.isin}`;
  if (p.type === 'plan') return null;
  if (p.morningstarId) return `https://www.morningstar.es/es/funds/snapshot/snapshot.aspx?id=${p.morningstarId}`;
  return `https://www.morningstar.es/es/funds/SecuritySearchResults.aspx?search=${p.isin}`;
}

// Normalises index names so variants like "MSCI North America (custom 4pm LUX)" match "MSCI North America".
export const indexKey = (s: string) => s.toLowerCase().replace(/\(.*?\)/g, '').replace(/\s+/g, ' ').trim();

/** Cheapest catalog fund tracking the same index as `p`, if it is meaningfully cheaper. */
export function cheaperAlternative(p: Product | undefined): Product | null {
  if (!p || p.type !== 'fondo' || !p.index || p.totalCost == null) return null;
  const key = indexKey(p.index);
  let best: Product | null = null;
  for (const c of catalog.items) {
    if (c.type !== 'fondo' || c.id === p.id || !c.index || c.totalCost == null || indexKey(c.index) !== key) continue;
    if (c.totalCost <= p.totalCost - 0.01 && (!best || c.totalCost < best.totalCost!)) best = c;
  }
  return best;
}

/** Other products of the same type tracking the same index (ETFs/plans: same category), cheapest first. */
export function sameIndex(p: Product): Product[] {
  const key = p.index ? indexKey(p.index) : null;
  return catalog.items
    .filter((c) => c.type === p.type && c.id !== p.id &&
      (key ? c.index != null && indexKey(c.index) === key : c.assetClass === p.assetClass && c.region === p.region))
    .sort((a, b) => (a.totalCost ?? 99) - (b.totalCost ?? 99));
}

/** Cheapest product per category (asset class + region; plans: asset class). */
export function cheapestByCategory(type: Product['type']) {
  const best = new Map<string, Product>();
  for (const p of catalog.items) {
    if (p.type !== type || p.totalCost == null) continue;
    const key = type === 'plan' ? p.assetClass ?? '' : `${p.assetClass}|${p.region ?? ''}`;
    const cur = best.get(key);
    if (!cur || p.totalCost < cur.totalCost!) best.set(key, p);
  }
  return [...best.values()];
}

export const maxCost = (type: Product['type']) =>
  Math.max(...catalog.items.filter((p) => p.type === type && p.totalCost != null).map((p) => p.totalCost!));
