// Parsing and browser-only storage of "Plusvalías y minusvalías" CSV exports.
// Nothing here ever leaves the browser.

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
