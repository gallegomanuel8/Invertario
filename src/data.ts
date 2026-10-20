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
