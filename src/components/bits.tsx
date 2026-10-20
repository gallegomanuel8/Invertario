import { maxCost } from '../data';
import type { Product } from '../types';

const SHORT: Record<string, string> = { 'Renta Variable': 'RV', 'Renta Fija': 'RF', Multiactivo: 'Mixto' };
const TAG_CLASS: Record<string, string> = { 'Renta Variable': 'tag-rv', 'Renta Fija': 'tag-rf', Multiactivo: 'tag-mix' };

export function AssetTag({ p }: { p: Product }) {
  if (!p.assetClass) return null;
  return <span className={`tag ${TAG_CLASS[p.assetClass] ?? 'tag-mix'}`} title={p.assetClass}>{SHORT[p.assetClass] ?? p.assetClass}</span>;
}

const maxByType = { fondo: maxCost('fondo'), etf: maxCost('etf'), plan: maxCost('plan') };

/** Thin magnitude bar: cost relative to the most expensive product of the same type. */
export function CostBar({ p }: { p: Product }) {
  if (p.totalCost == null) return null;
  const pct = Math.max(4, (p.totalCost / maxByType[p.type]) * 100);
  return (
    <div className="costbar" aria-hidden title="Coste relativo al más caro de su tipo">
      <div style={{ width: `${pct}%` }} />
    </div>
  );
}
