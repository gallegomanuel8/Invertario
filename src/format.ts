const eur = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });
const pct = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateFmt = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });

export const fmtEur = (n: number) => eur.format(n);
export const fmtSignedEur = (n: number) => (n > 0 ? '+' : '') + eur.format(n);
export const fmtPct = (n: number | null | undefined, digits = 2) =>
  n == null ? '—' : new Intl.NumberFormat('es-ES', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n) + ' %';
export const fmtSignedPct = (n: number) => (n > 0 ? '+' : '') + pct.format(n) + ' %';
export const fmtDate = (iso: string | null | undefined) => (iso ? dateFmt.format(new Date(iso)) : '—');
