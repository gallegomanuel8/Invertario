// Parsing and browser-only storage of "Plusvalías y minusvalías" CSV exports.
// Holdings never leave the browser; only the ISIN of funds missing from the catalog is looked up (see lookupFundInfo).
import type { FundInfo } from '../api/fund';
import type { Product } from './types';

export interface Lot {
  date: string; // ISO yyyy-mm-dd (fecha fiscal de la suscripción)
  invested: number;
  value: number;
  result: number;
  shares?: number; // broker transaction exports: units bought (value = shares × price)
}

export interface Holding {
  isin: string;
  fileName: string;
  importedAt: string;
  fileDate?: string; // when the CSV was downloaded (File.lastModified): its valuation date is the day before
  name?: string; // user-given name for funds not in the catalog
  info?: FundInfo | null; // looked up by ISIN for funds not in the catalog (null = not found)
  infoCheckedAt?: string;
  infoVersion?: number; // bump LOOKUP_VERSION to re-check everything after a lookup fix
  baseNav?: Nav | null; // NAV when the CSV was exported (fixed until the fund is re-imported)
  nav?: Nav; // latest NAV
  navCheckedAt?: string;
  lots: Lot[];
  notTransferTo?: string[]; // destination ISINs the user said are not a transfer from this fund
  broker?: 'Trade Republic'; // imported from that broker's transaction export (lots carry shares)
  dividends?: number; // net dividends received (€), from transaction exports
  realized?: number; // realised result of sales (€), from transaction exports
}

/** One tracked portfolio ("cartera"): the user can follow several, each with its own CSVs. */
export interface Folio { id: string; name: string; holdings: Holding[] }

const LEGACY_KEY = 'invertario.portfolio.v1'; // single portfolio, before Folio
export const FOLIOS_KEY = 'invertario.portfolios.v1';
const ISIN_RE = /[A-Z]{2}[A-Z0-9]{9}\d/;

const toNumber = (v: string) => Number(v.trim().replace(/\./g, '').replace(',', '.'));
const toIsoDate = (v: string) => {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v.trim());
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
};

export function parseHoldingCsv(fileName: string, text: string, fileDate?: number): Holding {
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
  return {
    isin, fileName, importedAt: new Date().toISOString(),
    ...(fileDate && Number.isFinite(fileDate) ? { fileDate: new Date(fileDate).toISOString() } : {}),
    lots,
  };
}

// ---- Trade Republic «Exportación de transacciones» (one CSV for the whole account) ----

/** Splits one CSV line with double-quoted fields ("" escapes a quote). */
function csvCells(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '', quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

export const isTransactionExport = (text: string) => {
  const head = text.replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0].toLowerCase();
  return head.includes('transaction_id') && head.includes('symbol') && head.includes('shares');
};

/**
 * Builds one holding per ISIN from a Trade Republic transaction export. Only trades and dividends are
 * read (symbol, date, shares, price, amount, fee, tax): transfers, card payments, names and IBANs in the
 * file are ignored and never stored. Sales consume the oldest lots first (FIFO), like Spanish tax rules.
 */
export function parseTransactionCsv(fileName: string, text: string, fileDate?: number): { holdings: Holding[]; skipped: string[] } {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim());
  const sep = lines[0].includes(';') && !lines[0].includes(',') ? ';' : ',';
  const header = csvCells(lines[0], sep).map((h) => h.trim().toLowerCase());
  const col = (n: string) => header.indexOf(n);
  const c = { date: col('date'), time: col('datetime'), category: col('category'), type: col('type'), name: col('name'), symbol: col('symbol'), shares: col('shares'), price: col('price'), amount: col('amount'), fee: col('fee'), tax: col('tax'), cls: col('asset_class') };
  if ([c.date, c.symbol, c.shares, c.amount].some((i) => i < 0)) throw new Error(`«${fileName}» no tiene las columnas esperadas de una exportación de transacciones`);
  const num = (v?: string) => (v && v.trim() ? Number(v.trim()) : 0);
  const rows = lines.slice(1).map((l) => csvCells(l, sep)).sort((a, b) => (a[c.time] ?? a[c.date]).localeCompare(b[c.time] ?? b[c.date]));
  const byIsin = new Map<string, { name: string; lots: Lot[]; dividends: number; realized: number }>();
  const skipped = new Set<string>();
  for (const r of rows) {
    const symbol = (r[c.symbol] ?? '').trim().toUpperCase();
    const type = (r[c.type] ?? '').toUpperCase();
    const trade = (r[c.category] ?? '').toUpperCase() === 'TRADING';
    if (!symbol || (!trade && type !== 'DIVIDEND')) continue;
    // Crypto bought directly has a pseudo-ISIN (XF000BTC0017) with no market data: report it, don't track it.
    if (!ISIN_RE.test(symbol) || (r[c.cls] ?? '').toUpperCase() === 'CRYPTO') { skipped.add(r[c.name] || symbol); continue; }
    const date = (r[c.date] ?? '').slice(0, 10);
    const h = byIsin.get(symbol) ?? { name: r[c.name] ?? '', lots: [], dividends: 0, realized: 0 };
    byIsin.set(symbol, h);
    const amount = num(r[c.amount]), fee = num(r[c.fee]), tax = num(r[c.tax]);
    if (!trade) { h.dividends += amount + tax; continue; } // tax comes negative
    const shares = Math.abs(num(r[c.shares]));
    if (!shares || !amount) continue;
    if (amount < 0) {
      // buy: cost includes the fee (it counts for the tax cost basis)
      const invested = -amount - fee;
      h.lots.push({ date, invested, value: -amount, result: -amount - invested, shares });
    } else {
      let left = shares, cost = 0;
      while (left > 1e-9 && h.lots.length) {
        const lot = h.lots[0];
        const take = Math.min(left, lot.shares!);
        const part = take / lot.shares!;
        cost += lot.invested * part;
        lot.invested -= lot.invested * part; lot.value -= lot.value * part; lot.result = lot.value - lot.invested;
        lot.shares! -= take; left -= take;
        if (lot.shares! <= 1e-9) h.lots.shift();
      }
      h.realized += amount + fee + tax - cost;
    }
  }
  const importedAt = new Date().toISOString();
  const holdings: Holding[] = [];
  for (const [isin, h] of byIsin) {
    if (!h.lots.length) continue; // fully sold
    holdings.push({
      isin, fileName, importedAt, name: h.name || undefined, broker: 'Trade Republic', lots: h.lots,
      ...(fileDate && Number.isFinite(fileDate) ? { fileDate: new Date(fileDate).toISOString() } : {}),
      ...(h.dividends ? { dividends: Math.round(h.dividends * 100) / 100 } : {}),
      ...(h.realized ? { realized: Math.round(h.realized * 100) / 100 } : {}),
    });
  }
  if (!holdings.length && !skipped.size) throw new Error(`«${fileName}» no contiene compras de valores con ISIN`);
  return { holdings, skipped: [...skipped] };
}

/** Any supported CSV: a «Plusvalías y minusvalías» export (one fund) or a broker transaction export. */
export function parseCsvFile(fileName: string, text: string, fileDate?: number): { holdings: Holding[]; skipped: string[] } {
  if (isTransactionExport(text)) return parseTransactionCsv(fileName, text, fileDate);
  return { holdings: [parseHoldingCsv(fileName, text, fileDate)], skipped: [] };
}

export const newFolioId = () => Math.random().toString(36).slice(2, 10);
export const DEFAULT_FOLIO = 'principal';

/** Loads all portfolios, migrating the old single-portfolio storage into "Mi cartera". */
export function loadFolios(): Folio[] {
  try {
    const raw = localStorage.getItem(FOLIOS_KEY);
    if (raw) {
      const folios = JSON.parse(raw) as Folio[];
      if (Array.isArray(folios) && folios.length) return folios;
    }
    const legacy = localStorage.getItem(LEGACY_KEY);
    return [{ id: DEFAULT_FOLIO, name: 'Mi cartera', holdings: legacy ? (JSON.parse(legacy) as Holding[]) : [] }];
  } catch {
    return [{ id: DEFAULT_FOLIO, name: 'Mi cartera', holdings: [] }];
  }
}

export function saveFolios(folios: Folio[]) {
  try {
    const empty = folios.length === 1 && !folios[0].holdings.length && folios[0].id === DEFAULT_FOLIO && folios[0].name === 'Mi cartera';
    if (empty) localStorage.removeItem(FOLIOS_KEY);
    else localStorage.setItem(FOLIOS_KEY, JSON.stringify(folios));
    localStorage.removeItem(LEGACY_KEY); // migrated
  } catch {
    /* storage unavailable (private mode): data lives only for this session */
  }
}

/** When the CSV's data is from: the download date if the browser gave it, else the import date. */
export const csvDate = (h: Holding) => h.fileDate ?? h.importedAt;
const lastLot = (h: Holding) => h.lots.at(-1)?.date ?? '';
/** Is `a` a more recent export than `b`? Newer file wins; same file date → the one with later or more lots. */
const newer = (a: Holding, b: Holding) =>
  a.fileDate && b.fileDate && a.fileDate !== b.fileDate ? a.fileDate > b.fileDate
    : lastLot(a) !== lastLot(b) ? lastLot(a) > lastLot(b) : a.lots.length >= b.lots.length;

/**
 * Merges freshly parsed CSVs into a portfolio. Several files for one ISIN (e.g. "… 2.csv" downloads)
 * keep only the newest; a file older than the one already imported is ignored.
 */
export function mergeImport(cur: Holding[], parsed: Holding[]): { holdings: Holding[]; duplicates: number; stale: string[] } {
  let duplicates = 0;
  const stale: string[] = [];
  const best = new Map<string, Holding>();
  for (const p of parsed) {
    const other = best.get(p.isin);
    if (!other) best.set(p.isin, p);
    else {
      const [keep, drop] = newer(p, other) ? [p, other] : [other, p];
      best.set(p.isin, keep);
      if (drop !== keep) duplicates++;
    }
  }
  const incoming: Holding[] = [];
  for (const p of best.values()) {
    const prev = cur.find((h) => h.isin === p.isin);
    // the very same export again: keep what we have (including fetched prices)
    if (prev?.fileDate && prev.fileDate === p.fileDate && prev.lots.length === p.lots.length) continue;
    if (prev && !newer(p, prev)) {
      stale.push(p.fileName);
      continue;
    }
    // keep the user's name, identified fund data and transfer decisions; prices restart from the new CSV
    incoming.push({ ...p, name: p.name ?? prev?.name, info: prev?.info, infoCheckedAt: prev?.infoCheckedAt, infoVersion: prev?.infoVersion, notTransferTo: prev?.notTransferTo });
  }
  return { holdings: [...cur.filter((h) => !incoming.some((p) => p.isin === h.isin)), ...incoming], duplicates, stale };
}

// ---- Transfers (traspasos): the destination fund keeps the origin's fiscal lots (same dates and amounts) ----

export interface Transfer {
  from: Holding;
  to: Holding;
  lots: Lot[]; // the destination's lots that came from the origin
}

const sameLot = (a: Lot, b: Lot) => a.date === b.date && Math.abs(a.invested - b.invested) < 0.011;

/**
 * A fund whose every lot reappears (same fiscal date and amount) in a fund exported later is treated as
 * transferred into it: Spanish fund transfers keep the original fiscal lots.
 */
export function detectTransfers(holdings: Holding[]): Transfer[] {
  const out: Transfer[] = [];
  for (const from of holdings) {
    if (!from.lots.length || from.broker) continue; // listed shares/ETFs can't be transferred tax-free
    for (const to of holdings) {
      if (to === from || to.lots.length < from.lots.length || csvDate(to) <= csvDate(from)) continue;
      if (from.notTransferTo?.includes(to.isin)) continue;
      const pool = [...to.lots];
      const matched: Lot[] = [];
      for (const l of from.lots) {
        const i = pool.findIndex((x) => sameLot(x, l));
        if (i < 0) break;
        matched.push(pool.splice(i, 1)[0]);
      }
      if (matched.length === from.lots.length) { out.push({ from, to, lots: matched }); break; }
    }
  }
  return out;
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
export const LOOKUP_VERSION = 4; // 3: ETFs/ETCs on FT.com; 4: shares (acciones) too
/** Funds missing from the catalog that were never looked up, whose lookup failed over a week ago,
 *  or that only got a name from OpenFIGI before a lookup improvement. */
export const needsLookup = (h: Holding, inCatalog: boolean) =>
  !inCatalog && (h.info === undefined ||
    (h.info?.source === 'OpenFIGI' && h.infoVersion !== LOOKUP_VERSION) ||
    (h.info === null && (h.infoVersion !== LOOKUP_VERSION || Date.now() - new Date(h.infoCheckedAt ?? 0).getTime() > RETRY_MS)));

/** Catalog-shaped product built from looked-up data, so costs and asset type work like catalog funds. */
export function externalProduct(info: FundInfo, checkedAt?: string): Product {
  return {
    external: { source: info.source, url: info.url, domicile: info.domicile, checkedAt: checkedAt ?? new Date().toISOString() },
    id: `ext-${info.isin}`, type: info.kind === 'stock' ? 'accion' : 'fondo', isin: info.isin, name: info.name,
    assetClass: info.assetClass, region: info.category, totalCost: info.ongoingCharge, ter: info.ongoingCharge, addedAt: null,
  };
}

// ---- Live values: CSV market values rescaled by the fund's NAV change since the CSV was imported ----

export const PRICE_TTL_MS = 6 * 3_600_000;

export interface Nav { price: number; date: string; currency: string }

/** The CSV has no valuation date; brokers usually value at the previous business day's NAV. */
export const baseDateFor = (h: Holding) => {
  const d = new Date(csvDate(h));
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
// Only EUR prices: CSV values are in euros, so a USD/GBP price ratio would ignore the exchange-rate move.
export function navFactor(h: Holding): number {
  if (h.broker) {
    // transaction exports know the shares: value = shares × current price (euro prices only)
    const value = sum(h.lots.map((l) => l.value));
    return h.nav?.currency === 'EUR' && value > 0 ? sum(h.lots.map((l) => (l.shares ?? 0) * h.nav!.price)) / value : 1;
  }
  if (!h.nav || !h.baseNav || h.nav.currency !== 'EUR' || h.baseNav.currency !== 'EUR' || h.baseNav.price <= 0) return 1;
  return h.nav.date > h.baseNav.date ? h.nav.price / h.baseNav.price : 1;
}

export function withLiveValues(h: Holding): Holding {
  const f = navFactor(h);
  if (f === 1) return h;
  const valueOf = (l: Lot) => (h.broker && l.shares != null ? l.shares * h.nav!.price : l.value * f);
  return { ...h, lots: h.lots.map((l) => ({ ...l, value: valueOf(l), result: valueOf(l) - l.invested })) };
}
