// Products looked up by ISIN outside the catalog ("no catalogado"), kept only in this browser so they can be
// opened, compared and used in the simulator like catalog products. Only the ISIN is sent (to our /api/fund).
import { useSyncExternalStore } from 'react';
import type { FundInfo } from '../api/fund';
import { catalog } from './data';
import { lookupFundInfo } from './portfolio';
import type { Product } from './types';

export const EXTERNAL_KEY = 'invertario.external.v1';
export const ISIN_RE = /^[A-Z]{2}[A-Z0-9]{9}\d$/;
export const externalId = (isin: string) => `ext-${isin}`;

const catalogById = new Map(catalog.items.map((p) => [p.id, p]));
const listeners = new Set<() => void>();
let state: Product[] = load();

function load(): Product[] {
  try {
    const raw = localStorage.getItem(EXTERNAL_KEY);
    const list = raw ? (JSON.parse(raw) as Product[]) : [];
    return Array.isArray(list) ? list.filter((p) => p?.external && typeof p.id === 'string') : [];
  } catch {
    return [];
  }
}

function commit(next: Product[]) {
  state = next;
  try {
    if (next.length) localStorage.setItem(EXTERNAL_KEY, JSON.stringify(next));
    else localStorage.removeItem(EXTERNAL_KEY);
  } catch {
    /* storage unavailable: keep in memory for this session */
  }
  listeners.forEach((l) => l());
}

export function useExternal() {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l); },
    () => state,
  );
}

/** Catalog product or a looked-up one, by id. */
export const productById = (id: string): Product | undefined => catalogById.get(id) ?? state.find((p) => p.id === id);
export const isKnownId = (id: string) => catalogById.has(id) || state.some((p) => p.id === id) || (id.startsWith('ext-') && ISIN_RE.test(id.slice(4)));

export function toProduct(info: FundInfo): Product {
  return {
    id: externalId(info.isin), type: info.kind === 'stock' ? 'accion' : /\bETF\b|\bUCITS ETF\b/i.test(info.name) ? 'etf' : 'fondo',
    isin: info.isin, name: info.name, assetClass: info.assetClass, region: info.category,
    totalCost: info.ongoingCharge, ter: info.ongoingCharge, addedAt: null,
    external: { source: info.source, url: info.url, domicile: info.domicile, checkedAt: new Date().toISOString() },
  };
}

/** Looks the ISIN up and remembers it. Resolves to null when neither FT.com nor OpenFIGI know it; throws on network errors. */
export async function lookupExternal(isin: string): Promise<Product | null> {
  const existing = state.find((p) => p.isin === isin);
  if (existing) return existing;
  const info = await lookupFundInfo(isin);
  if (!info) return null;
  const p = toProduct(info);
  commit([...state.filter((x) => x.id !== p.id), p]);
  return p;
}

export function removeExternal(id: string) {
  commit(state.filter((p) => p.id !== id));
}
