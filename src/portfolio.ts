// Parsing and browser-only storage of "Plusvalías y minusvalías" CSV exports.
// Holdings never leave the browser; only the ISIN of funds missing from the catalog is looked up (see lookupFundInfo).
import type { FundInfo } from '../api/fund';
import type { Product } from './types';

export interface Lot {
  date: string; // ISO yyyy-mm-dd (fecha fiscal de la suscripción)
  invested: number;
  value: number;
  result: number;
}

export interface Holding {
  isin: string;
  fileName: string;
  importedAt: string;
  name?: string; // user-given name for funds not in the catalog
  info?: FundInfo | null; // looked up by ISIN for funds not in the catalog (null = not found)
  infoCheckedAt?: string;
  infoVersion?: number; // bump LOOKUP_VERSION to re-check everything after a lookup fix
  baseNav?: Nav | null; // NAV when the CSV was exported (fixed until the fund is re-imported)
  nav?: Nav; // latest NAV
  navCheckedAt?: string;
  lots: Lot[];
}

const STORAGE_KEY = 'invertario.portfolio.v1';
const ISIN_RE = /[A-Z]{2}[A-Z0-9]{9}\d/;

const toNumber = (v: string) => Number(v.trim().replace(/\./g, '').replace(',', '.'));
const toIsoDate = (v: string) => {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v.trim());
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
};

export function parseHoldingCsv(fileName: string, text: string): Holding {
  const isin = ISIN_RE.exec(fileName.toUpperCase())?.[0];
  if (!isin) throw new Error(`No se encuentra el ISIN en el nombre del archivo «${fileName}»`);
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  const sep = lines[0]?.includes(';') ? ';' : ',';
  const header = lines[0]?.split(sep).map((h) => h.trim().toLowerCase()) ?? [];
  const col = (name: string) => header.findIndex((h) => h.startsWith(name));
  const idx = { date: col('fecha'), invested: col('inversi'), value: col('valor'), result: col('resultado') };
  if (Object.values(idx).some((i) => i < 0)) {
    throw new Error(`«${fileName}» no tiene las columnas esperadas (Fecha fiscal; Inversión; Valor de mercado; Resultado fiscal)`);
  }
  const lots: Lot[] = [];
  for (const line of lines.slice(1)) {
    const cells = line.split(sep);
    const date = toIsoDate(cells[idx.date] ?? '');
    const invested = toNumber(cells[idx.invested] ?? '');
    const value = toNumber(cells[idx.value] ?? '');
    if (!date || !Number.isFinite(invested) || !Number.isFinite(value)) continue;
    const result = toNumber(cells[idx.result] ?? '');
    lots.push({ date, invested, value, result: Number.isFinite(result) ? result : value - invested });
  }
  if (!lots.length) throw new Error(`«${fileName}» no contiene movimientos válidos`);
  lots.sort((a, b) => a.date.localeCompare(b.date));
  return { isin, fileName, importedAt: new Date().toISOString(), lots };
}

export function loadHoldings(): Holding[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Holding[]) : [];
  } catch {
    return [];
  }
}

export function saveHoldings(holdings: Holding[]) {
  try {
    if (holdings.length) localStorage.setItem(STORAGE_KEY, JSON.stringify(holdings));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable (private mode): data lives only for this session */
  }
}

export const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export function totals(lots: Lot[]) {
  const invested = sum(lots.map((l) => l.invested));
  const value = sum(lots.map((l) => l.value));
  const result = value - invested;
  return { invested, value, result, pct: invested ? (result / invested) * 100 : 0 };
}

/** Asks our /api/fund endpoint (FT.com behind it) about a fund. Sends only the ISIN. */
export async function lookupFundInfo(isin: string): Promise<FundInfo | null> {
  const res = await fetch(`/api/fund?isin=${encodeURIComponent(isin)}`);
  const body = await res.json().catch(() => null);
  // Only our function's explicit "not found" counts as a result; a platform 404/500 must be retried later.
  if (res.status === 404 && body?.error === 'No encontrado') return null;
  if (!res.ok || !body?.isin) throw new Error(`HTTP ${res.status}`);
  return body as FundInfo;
}

const RETRY_MS = 7 * 86_400_000;
export const LOOKUP_VERSION = 2;
/** Funds missing from the catalog that were never looked up, or whose lookup failed over a week ago. */
export const needsLookup = (h: Holding, inCatalog: boolean) =>
  !inCatalog && (h.info === undefined || (h.info === null &&
    (h.infoVersion !== LOOKUP_VERSION || Date.now() - new Date(h.infoCheckedAt ?? 0).getTime() > RETRY_MS)));

/** Catalog-shaped product built from looked-up data, so costs and asset type work like catalog funds. */
export function externalProduct(info: FundInfo): Product {
  return {
    id: `ext-${info.isin}`, type: 'fondo', isin: info.isin, name: info.name,
    assetClass: info.assetClass, region: info.category, totalCost: info.ongoingCharge, ter: info.ongoingCharge, addedAt: null,
  };
}

// ---- Live values: CSV market values rescaled by the fund's NAV change since the CSV was imported ----

export const PRICE_TTL_MS = 6 * 3_600_000;

export interface Nav { price: number; date: string; currency: string }

/** The CSV has no valuation date; brokers usually value at the previous business day's NAV. */
export const baseDateFor = (h: Holding) => {
  const d = new Date(h.importedAt);
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
};

export const pricesStale = (h: Holding) => Date.now() - new Date(h.navCheckedAt ?? 0).getTime() > PRICE_TTL_MS;

/** Current NAV and the NAV on/before the CSV valuation date. Sends only the ISIN and that date. */
export async function fetchNavs(h: Holding): Promise<{ nav: Nav; baseNav: Nav | null }> {
  const res = await fetch(`/api/fund?isin=${encodeURIComponent(h.isin)}&since=${baseDateFor(h)}`);
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.current) throw new Error(`HTTP ${res.status}`);
  const nav = { ...body.current, currency: body.currency } as Nav;
  return { nav, baseNav: body.base ? { ...body.base, currency: body.currency } : null };
}

/** Ratio applied to every lot's CSV market value (units don't change, only the price). 1 when unknown. */
export function navFactor(h: Holding): number {
  if (!h.nav || !h.baseNav || h.nav.currency !== h.baseNav.currency || h.baseNav.price <= 0) return 1;
  return h.nav.date > h.baseNav.date ? h.nav.price / h.baseNav.price : 1;
}

export function withLiveValues(h: Holding): Holding {
  const f = navFactor(h);
  if (f === 1) return h;
  return { ...h, lots: h.lots.map((l) => ({ ...l, value: l.value * f, result: l.value * f - l.invested })) };
}
