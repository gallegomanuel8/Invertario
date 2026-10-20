const eur = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', useGrouping: 'always' });
const pct = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' });
const dateFmt = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });

export const fmtEur = (n: number) => eur.format(n);
export const fmtSignedEur = (n: number) => (n > 0 ? '+' : '') + eur.format(n);
export const fmtPct = (n: number | null | undefined, digits = 2) =>
  n == null ? '—' : new Intl.NumberFormat('es-ES', { minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: 'always' }).format(n) + ' %';
export const fmtSignedPct = (n: number) => (n > 0 ? '+' : '') + pct.format(n) + ' %';
export const fmtDate = (iso: string | null | undefined) => (iso ? dateFmt.format(new Date(iso)) : '—');

/** Spreadsheet-provided percentage strings ("6,9%") with the Spanish non-breaking space before %. */
export const fmtRawPct = (v: string | null | undefined) => (v ? v.replace(/(\d)\s*%/g, '$1\u00a0%') : '—');
