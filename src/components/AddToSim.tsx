import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { addFundToSim, createSim, useSims } from '../sims';
import type { Product } from '../types';

const MENU_W = 260;

/**
 * "Añadir al simulador" button with a small menu: pick an existing simulated portfolio or create one.
 * The menu is position: fixed so it is never clipped by scrollable containers such as the catalog table.
 */
export function AddToSim({ p, compact }: { p: Product; compact?: boolean }) {
  const sims = useSims();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number } | null>(null);
  const [done, setDone] = useState<{ id: string; name: string } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  // Keep the fixed menu glued to its button while the page (or a scroll container) moves.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      if (!btn.current) return;
      const r = btn.current.getBoundingClientRect();
      const left = Math.max(8, Math.min(r.right - MENU_W, innerWidth - MENU_W - 8));
      const below = innerHeight - r.bottom > 240 || r.top < 240;
      setPos(below ? { left, top: r.bottom + 6 } : { left, bottom: innerHeight - r.top + 6 });
    };
    place();
    addEventListener('scroll', place, true);
    addEventListener('resize', place);
    return () => {
      removeEventListener('scroll', place, true);
      removeEventListener('resize', place);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e.type === 'keydown' && (e as KeyboardEvent).key !== 'Escape') return;
      if (e.type === 'mousedown' && (menu.current?.contains(e.target as Node) || btn.current?.contains(e.target as Node))) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  useEffect(() => {
    if (!done || !compact) return;
    const t = setTimeout(() => setDone(null), 4000);
    return () => clearTimeout(t);
  }, [done, compact]);

  const add = (simId: string, name: string) => {
    addFundToSim(simId, p.id);
    setDone({ id: simId, name });
    setOpen(false);
  };
  const createNew = () => {
    const name = prompt('Nombre de la nueva cartera simulada:', `Cartera ${sims.length + 1}`);
    if (name == null) return;
    const sim = createSim(name, p.id);
    setDone({ id: sim.id, name: sim.name });
    setOpen(false);
  };

  const inSims = sims.filter((s) => s.funds.some((f) => f.id === p.id)).length;

  return (
    <div className="menu-wrap">
      <button
        ref={btn}
        className={compact ? 'compare-toggle' : 'btn'}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-pressed={compact ? inSims > 0 : undefined}
        aria-label={compact ? `Añadir ${p.name} al simulador` : undefined}
        title={compact && inSims ? `En ${inSims} ${inSims === 1 ? 'cartera simulada' : 'carteras simuladas'}` : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        {compact ? (inSims ? `✓ Simulador${inSims > 1 ? ` (${inSims})` : ''}` : '+ Simulador') : '+ Añadir al simulador'}
      </button>
      {open && pos && (
        <div ref={menu} className="menu" role="menu" style={{ position: 'fixed', left: pos.left, top: pos.top, bottom: pos.bottom, width: MENU_W }}>
          {sims.map((s) => {
            const has = s.funds.some((f) => f.id === p.id);
            return (
              <button key={s.id} role="menuitem" disabled={has} onClick={() => add(s.id, s.name)}>
                {s.name}<span className="muted small">{has ? 'ya incluido' : `${s.funds.length} fondos`}</span>
              </button>
            );
          })}
          <button role="menuitem" className="menu-new" onClick={createNew}>+ Nueva cartera simulada</button>
        </div>
      )}
      {done && (
        <p className="small added" role="status">
          {compact ? <>Añadido · </> : <>Añadido a «{done.name}». </>}
          <a href={`#/simulador/${done.id}`}>{compact ? `Ver «${done.name}»` : 'Ir al simulador'}</a>
        </p>
      )}
    </div>
  );
}
