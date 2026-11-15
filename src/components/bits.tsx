import { useEffect } from 'react';
import { maxCost } from '../data';
import type { Product } from '../types';

const SHORT: Record<string, string> = {
  'Renta Variable': 'RV', 'Renta Fija': 'RF', Multiactivo: 'Mixto',
  Criptomonedas: 'Cripto', 'Metales preciosos': 'Metales', 'Materias primas': 'Mat. primas',
};
const TAG_CLASS: Record<string, string> = {
  'Renta Variable': 'tag-rv', 'Renta Fija': 'tag-rf', Multiactivo: 'tag-mix',
  Criptomonedas: 'tag-crypto', 'Metales preciosos': 'tag-metal', 'Materias primas': 'tag-cmdty',
};

export function AssetTag({ p }: { p: Product }) {
  if (p.type === 'accion') return <span className="tag tag-rv" title="Acción (renta variable)">Acción</span>;
  if (!p.assetClass) return null;
  return <span className={`tag ${TAG_CLASS[p.assetClass] ?? 'tag-mix'}`} title={p.assetClass}>{SHORT[p.assetClass] ?? p.assetClass}</span>;
}

const maxByType = { fondo: maxCost('fondo'), etf: maxCost('etf'), plan: maxCost('plan'), alt: maxCost('alt'), accion: 0 };

/** Thin magnitude bar: cost relative to the most expensive product of the same type. */
export function CostBar({ p }: { p: Product }) {
  if (p.totalCost == null) return null;
  const pct = Math.max(4, (p.totalCost / (maxByType[p.type] || 1)) * 100);
  return (
    <div className="costbar" aria-hidden title="Coste relativo al más caro de su tipo">
      <div style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Closes an open <details> popover on outside click or Esc. */
export function useDismissDetails(ref: React.RefObject<HTMLDetailsElement | null>) {
  useEffect(() => {
    const close = (e: Event) => {
      const d = ref.current;
      if (!d?.open) return;
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !d.contains(e.target as Node)) d.open = false;
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
    };
  }, [ref]);
}
