// Export / import / wipe of everything Invertario keeps in this browser (localStorage only).
import type { Holding } from './portfolio';
import type { SimPortfolio } from './sims';

/** Any view can open the "Tus datos" sheet with dispatchEvent(new Event(OPEN_DATA_EVENT)). */
export const OPEN_DATA_EVENT = 'invertario:open-data';

const KEYS = {
  portfolio: 'invertario.portfolio.v1',
  sims: 'invertario.sims.v1',
  theme: 'invertario.theme',
} as const;

export interface Backup {
  app: 'invertario';
  version: 1;
  exportedAt: string;
  data: { portfolio: Holding[]; sims: SimPortfolio[]; theme: string | null };
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
  return { portfolio: read<Holding[]>(KEYS.portfolio, []), sims: read<SimPortfolio[]>(KEYS.sims, []), theme };
}

export function summary(d: Backup['data']) {
  return { funds: d.portfolio.length, lots: d.portfolio.reduce((a, h) => a + (h.lots?.length ?? 0), 0), sims: d.sims.length };
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
  const portfolio = Array.isArray(b.data.portfolio) ? b.data.portfolio : [];
  const sims = Array.isArray(b.data.sims) ? b.data.sims : [];
  if (!portfolio.every(isHolding) || !sims.every(isSim)) throw new Error('La copia de seguridad está dañada o incompleta.');
  const theme = b.data.theme === 'light' || b.data.theme === 'dark' ? b.data.theme : null;
  return { ...b, data: { portfolio, sims, theme } };
}

/** "replace" overwrites everything; "merge" keeps current data and adds/updates by ISIN and simulation id. */
export function applyBackup(b: Backup, mode: 'replace' | 'merge') {
  const cur = currentData();
  const next = mode === 'replace' ? b.data : {
    portfolio: [...cur.portfolio.filter((h) => !b.data.portfolio.some((x) => x.isin === h.isin)), ...b.data.portfolio],
    sims: [...cur.sims.filter((s) => !b.data.sims.some((x) => x.id === s.id)), ...b.data.sims],
    theme: b.data.theme ?? cur.theme,
  };
  const set = (key: string, value: unknown[] | string | null) => {
    if (value == null || (Array.isArray(value) && !value.length)) localStorage.removeItem(key);
    else localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
  };
  set(KEYS.portfolio, next.portfolio);
  set(KEYS.sims, next.sims);
  set(KEYS.theme, next.theme);
}

export function clearAll() {
  for (const key of Object.values(KEYS)) {
    try { localStorage.removeItem(key); } catch { /* ignore */ }
  }
}
