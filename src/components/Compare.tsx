import { catalog, productLink } from '../data';
import { fmtPct, fmtRawPct } from '../format';
import type { Product } from '../types';
import { AssetTag } from './bits';

const TYPE_LABEL: Record<Product['type'], string> = { fondo: 'Fondo indexado', etf: 'ETF', plan: 'Plan de pensiones' };

interface RowDef {
  label: string;
  value: (p: Product) => string | null | undefined;
  /** Numeric getter used to highlight the best value; `better` says whether lower or higher wins. */
  num?: (p: Product) => number | null | undefined;
  better?: 'low' | 'high';
}

export function Compare({ items, onRemove, onOpen }: { items: Product[]; onRemove: (p: Product) => void; onOpen: (p: Product) => void }) {
  const allRows: RowDef[] = [
    { label: 'Tipo', value: (p) => TYPE_LABEL[p.type] },
    { label: 'Categoría', value: (p) => [p.assetClass, p.type === 'plan' ? p.provider : p.region].filter(Boolean).join(' · ') },
    { label: 'Índice', value: (p) => p.index },
    { label: 'Coste total', value: (p) => fmtPct(p.totalCost, p.type === 'plan' ? 3 : 2), num: (p) => p.totalCost, better: 'low' },
    { label: 'TER', value: (p) => (p.ter != null ? fmtPct(p.ter) : null) },
    { label: 'Rentabilidad 3 años', value: (p) => (p.return3y != null ? fmtPct(p.return3y) : null), num: (p) => p.return3y, better: 'high' },
    { label: 'Rentabilidad 5 años', value: (p) => (p.return5y != null ? fmtPct(p.return5y) : null), num: (p) => p.return5y, better: 'high' },
    { label: 'Dividendos', value: (p) => p.distribution },
    { label: 'Ticker', value: (p) => p.ticker },
    { label: 'RV / RF', value: (p) => (p.equityPct != null ? `${p.equityPct} / ${100 - p.equityPct}` : null) },
    ...catalog.platforms.map((pl): RowDef => ({
      label: pl,
      value: (p) => (p.type !== 'fondo' ? null : p.platforms?.includes(pl) ? '✓' : '—'),
    })),
    { label: 'Préstamo de valores', value: (p) => (p.securitiesLending?.lent ? fmtRawPct(p.securitiesLending.lent) : null) },
  ];
  const rows = allRows.filter((r) => items.some((p) => r.value(p) != null && r.value(p) !== ''));

  const best = (r: RowDef) => {
    if (!r.num) return null;
    const vals = items.map((p) => r.num!(p)).filter((v): v is number => v != null);
    if (vals.length < 2) return null;
    return r.better === 'low' ? Math.min(...vals) : Math.max(...vals);
  };

  return (
    <div className="compare-wrap">
      <table className="compare">
        <thead>
          <tr>
            <th scope="col"><span className="sr-only">Dato</span></th>
            {items.map((p) => (
              <th key={p.id} scope="col">
                <div className="compare-head">
                  <AssetTag p={p} />
                  <button className="link compare-name" onClick={() => onOpen(p)}>{p.name}</button>
                  <span className="muted small mono">{p.isin ?? p.dgsCode}</span>
                  <div className="compare-actions">
                    {productLink(p) && <a className="small" href={productLink(p)!} target="_blank" rel="noreferrer">Ficha ↗</a>}
                    <button className="link small" onClick={() => onRemove(p)}>Quitar</button>
                  </div>
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const b = best(r);
            return (
              <tr key={r.label}>
                <th scope="row">{r.label}</th>
                {items.map((p) => {
                  const isBest = b != null && r.num!(p) === b;
                  return (
                    <td key={p.id} className={isBest ? 'best' : ''}>
                      {r.value(p) ?? '—'}
                      {isBest && <span className="best-label"> · {r.better === 'low' ? 'más barato' : 'mejor'}</span>}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      {items.length < 3 && <p className="muted small">Puedes añadir hasta 3 productos desde el catálogo o su ficha.</p>}
    </div>
  );
}
