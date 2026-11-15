// Export / import / wipe of everything Invertario keeps in this browser (localStorage only).
import { DEFAULT_FOLIO, type Folio, FOLIOS_KEY, type Holding, loadFolios } from './portfolio';
import type { SimPortfolio } from './sims';
import type { Product } from './types';

/** Any view can open the "Tus datos" sheet with dispatchEvent(new Event(OPEN_DATA_EVENT)). */
export const OPEN_DATA_EVENT = 'invertario:open-data';

const KEYS = {
  legacyPortfolio: 'invertario.portfolio.v1',
  portfolios: FOLIOS_KEY,
  sims: 'invertario.sims.v1',
  theme: 'invertario.theme',
  external: 'invertario.external.v1',
} as const;

export interface Backup {
  app: 'invertario';
  version: 1;
  exportedAt: string;
  data: { portfolios: Folio[]; sims: SimPortfolio[]; theme: string | null; external: Product[] };
}

const read = <T>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};

export function currentData(): Backup['data'] {
  let theme: string | null = null;
  try { theme = localStorage.getItem(KEYS.theme); } catch { /* ignore */ }
  return { portfolios: loadFolios().filter((f) => f.holdings.length || f.id !== DEFAULT_FOLIO), sims: read<SimPortfolio[]>(KEYS.sims, []), theme, external: read<Product[]>(KEYS.external, []) };
}

export function summary(d: Backup['data']) {
  const holdings = d.portfolios.flatMap((f) => f.holdings);
  return { funds: holdings.length, lots: holdings.reduce((a, h) => a + (h.lots?.length ?? 0), 0), sims: d.sims.length, folios: d.portfolios.length };
}

export function downloadBackup() {
  const backup: Backup = { app: 'invertario', version: 1, exportedAt: new Date().toISOString(), data: currentData() };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(blob),
    download: `invertario-copia-${backup.exportedAt.slice(0, 10)}.json`,
  });
  a.click();
  URL.revokeObjectURL(a.href);
}

const isHolding = (h: unknown): h is Holding =>
  !!h && typeof (h as Holding).isin === 'string' && Array.isArray((h as Holding).lots) &&
  (h as Holding).lots.every((l) => typeof l.date === 'string' && Number.isFinite(l.invested) && Number.isFinite(l.value));
const isSim = (s: unknown): s is SimPortfolio =>
  !!s && typeof (s as SimPortfolio).id === 'string' && typeof (s as SimPortfolio).name === 'string' && Array.isArray((s as SimPortfolio).funds);

/** Validates a backup file; throws a user-facing Spanish message when it is not usable. */
export function parseBackup(text: string): Backup {
  let b: Backup;
  try {
    b = JSON.parse(text);
  } catch {
    throw new Error('El archivo no es un JSON válido.');
  }
  if (b?.app !== 'invertario' || b.version !== 1 || !b.data) throw new Error('El archivo no es una copia de seguridad de Invertario.');
  // Copies made before several portfolios existed carry a single `portfolio` (list of holdings).
  const raw = b.data as Backup['data'] & { portfolio?: Holding[] };
  const portfolios: Folio[] = Array.isArray(raw.portfolios) ? raw.portfolios
    : Array.isArray(raw.portfolio) && raw.portfolio.length ? [{ id: DEFAULT_FOLIO, name: 'Mi cartera', holdings: raw.portfolio }] : [];
  const sims = Array.isArray(b.data.sims) ? b.data.sims : [];
  const okFolio = (f: Folio) => !!f && typeof f.id === 'string' && typeof f.name === 'string' && Array.isArray(f.holdings) && f.holdings.every(isHolding);
  if (!portfolios.every(okFolio) || !sims.every(isSim)) throw new Error('La copia de seguridad está dañada o incompleta.');
  const theme = b.data.theme === 'light' || b.data.theme === 'dark' ? b.data.theme : null;
  // Older backups have no looked-up products; keep only well-formed ones.
  const external = (Array.isArray(b.data.external) ? b.data.external : [])
    .filter((p) => p && typeof p.id === 'string' && p.id.startsWith('ext-') && typeof p.name === 'string' && p.external);
  return { ...b, data: { portfolios, sims, theme, external } };
}

/** "replace" overwrites everything; "merge" keeps current data and adds/updates by ISIN and simulation id. */
export function applyBackup(b: Backup, mode: 'replace' | 'merge') {
  const cur = currentData();
  const next = mode === 'replace' ? b.data : {
    // same portfolio (by id): funds merged by ISIN; other portfolios added
    portfolios: [
      ...cur.portfolios.map((f) => {
        const inc = b.data.portfolios.find((x) => x.id === f.id);
        return inc ? { ...f, holdings: [...f.holdings.filter((h) => !inc.holdings.some((x) => x.isin === h.isin)), ...inc.holdings] } : f;
      }),
      ...b.data.portfolios.filter((x) => !cur.portfolios.some((f) => f.id === x.id)),
    ],
    sims: [...cur.sims.filter((s) => !b.data.sims.some((x) => x.id === s.id)), ...b.data.sims],
    theme: b.data.theme ?? cur.theme,
    external: [...cur.external.filter((p) => !b.data.external.some((x) => x.id === p.id)), ...b.data.external],
  };
  const set = (key: string, value: unknown[] | string | null) => {
    if (value == null || (Array.isArray(value) && !value.length)) localStorage.removeItem(key);
    else localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
  };
  set(KEYS.portfolios, next.portfolios);
  set(KEYS.legacyPortfolio, null);
  set(KEYS.sims, next.sims);
  set(KEYS.theme, next.theme);
  set(KEYS.external, next.external);
}

export function clearAll() {
  for (const key of Object.values(KEYS)) {
    try { localStorage.removeItem(key); } catch { /* ignore */ }
  }
}
