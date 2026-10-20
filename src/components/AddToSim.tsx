import { useEffect, useRef, useState } from 'react';
import { addFundToSim, createSim, useSims } from '../sims';
import type { Product } from '../types';

/** "Añadir al simulador" button with a small menu: pick an existing simulated portfolio or create one. */
export function AddToSim({ p }: { p: Product }) {
  const sims = useSims();
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<{ id: string; name: string } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);

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

  return (
    <div className="menu-wrap" ref={ref}>
      <button className="btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        + Añadir al simulador
      </button>
      {open && (
        <div className="menu" role="menu">
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
          Añadido a «{done.name}». <a href={`#/simulador/${done.id}`}>Ir al simulador</a>
        </p>
      )}
    </div>
  );
}
