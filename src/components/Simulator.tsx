import { useMemo, useState } from 'react';
import { catalog } from '../data';
import { fmtEur, fmtPct, fmtSignedPct } from '../format';
import { addFundToSim, createSim, deleteSim, equalWeights, type ReturnMode, type SimPortfolio, updateSim, useSims } from '../sims';
import { fundAssumption, project, toCsv } from '../simulate';
import type { Product } from '../types';
import { AssetTag } from './bits';
import { ProjectionChart } from './Charts';

const byId = new Map(catalog.items.map((p) => [p.id, p]));

const TEMPLATES: { name: string; funds: [string, number][] }[] = [
  { name: 'Mundo desarrollado + emergentes (90/10)', funds: [['IE000ZYRH0Q7', 90], ['IE000QAZP7L2', 10]] },
  { name: 'Global equilibrada (60/40)', funds: [['IE000ZYRH0Q7', 55], ['IE000QAZP7L2', 5], ['IE00BD0NC037', 40]] },
  { name: 'S&P 500 + Europa (70/30)', funds: [['IE00BYX5MX67', 70], ['IE0007987708', 30]] },
];

const MODES: { id: ReturnMode; label: string; hint: string }[] = [
  { id: 'prudente', label: 'Prudente', hint: '6 % renta variable y 2,5 % renta fija al año, menos los costes de cada fondo.' },
  { id: 'historica', label: 'Histórica 5 años', hint: 'Rentabilidad anualizada de los últimos 5 años según la hoja comunitaria. El pasado no garantiza el futuro.' },
  { id: 'personalizada', label: 'Personalizada', hint: 'Indica tú la rentabilidad bruta esperada de cada fondo; se le restan sus costes.' },
];

const readSelected = () => location.hash.match(/^#\/simulador\/([\w-]+)/)?.[1] ?? null;

export function Simulator() {
  const sims = useSims();
  const [selectedId, setSelectedId] = useState<string | null>(readSelected);
  const sim = sims.find((s) => s.id === selectedId) ?? sims[0] ?? null;

  const select = (id: string) => {
    setSelectedId(id);
    history.replaceState(null, '', `#/simulador/${id}`);
  };
  const create = (name?: string, funds?: [string, number][]) => {
    const n = name ?? prompt('Nombre de la cartera simulada:', `Cartera ${sims.length + 1}`);
    if (n == null) return;
    const s = createSim(n);
    const valid = (funds ?? []).filter(([id]) => byId.has(id));
    if (valid.length) updateSim(s.id, { funds: valid.map(([id, weight]) => ({ id, weight })) });
    select(s.id);
  };

  return (
    <section>
      <div className="hero hero-compact">
        <div className="hero-text">
          <p className="eyebrow">Planifica</p>
          <h1>Simulador de carteras</h1>
          <p className="muted">
            Crea carteras con fondos del catálogo y calcula cuánto podrían valer con aportaciones periódicas, interés compuesto,
            los costes reales de cada fondo y la inflación.
          </p>
        </div>
        <p className="privacy">
          <span aria-hidden>🔒</span> Tus carteras simuladas se guardan <strong>solo en este navegador</strong>.
        </p>
      </div>

      {sims.length > 0 && (
        <div className="sim-tabs" role="tablist" aria-label="Carteras simuladas">
          {sims.map((s) => (
            <button key={s.id} role="tab" aria-selected={s.id === sim?.id} onClick={() => select(s.id)}>{s.name}</button>
          ))}
          <button className="sim-new" onClick={() => create()}>+ Nueva cartera</button>
        </div>
      )}

      {sim ? <SimEditor key={sim.id} sim={sim} onDeleted={() => setSelectedId(null)} /> : (
        <div className="panel sim-empty">
          <h2>Crea tu primera cartera simulada</h2>
          <p className="muted">Empieza desde cero o usa una plantilla con fondos indexados de bajo coste. Podrás cambiarlo todo.</p>
          <div className="templates">
            {TEMPLATES.map((t) => (
              <button key={t.name} className="pick" onClick={() => create(t.name, t.funds)}>
                <span className="pick-name">{t.name}</span>
                <span className="muted small">{t.funds.map(([id, w]) => `${w} % ${byId.get(id)?.index ?? id}`).join(' · ')}</span>
              </button>
            ))}
          </div>
          <button className="btn btn-primary" onClick={() => create()}>+ Cartera vacía</button>
          <p className="muted small">También puedes añadir fondos desde su ficha en el catálogo con «+ Añadir al simulador».</p>
        </div>
      )}
    </section>
  );
}

function SimEditor({ sim, onDeleted }: { sim: SimPortfolio; onDeleted: () => void }) {
  const set = (patch: Partial<SimPortfolio>) => updateSim(sim.id, patch);
  const [showTable, setShowTable] = useState(false);

  const funds = sim.funds
    .map((f) => ({ f, p: byId.get(f.id) }))
    .filter((x): x is { f: typeof x.f; p: Product } => x.p != null);
  const assumptions = funds.map(({ f, p }) => fundAssumption(p, f.weight, sim.returnMode, f.customReturn));
  // assumptions derive entirely from `sim`, so it is the only dependency
  const proj = useMemo(() => project(sim, assumptions), [sim]);
  const last = proj.rows.at(-1);
  const weightSum = sim.funds.reduce((a, f) => a + f.weight, 0);
  const costImpact = last ? last.noCosts - last.value : 0;

  const setFund = (id: string, patch: Partial<SimPortfolio['funds'][number]>) =>
    set({ funds: sim.funds.map((f) => (f.id === id ? { ...f, ...patch } : f)) });
  const removeFund = (id: string) => set({ funds: sim.funds.filter((f) => f.id !== id) });
  const rename = () => {
    const name = prompt('Nuevo nombre:', sim.name)?.trim();
    if (name) set({ name });
  };
  const remove = () => {
    if (confirm(`¿Borrar la cartera simulada «${sim.name}»?`)) { deleteSim(sim.id); onDeleted(); }
  };
  const download = () => {
    const blob = new Blob(['﻿' + toCsv(proj.rows)], { type: 'text/csv;charset=utf-8' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `${sim.name}.csv` });
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="sim-grid">
      <div className="sim-side">
        <div className="panel">
          <div className="panel-head">
            <h2>{sim.name}</h2>
            <div className="row-actions">
              <button className="link" onClick={rename}>Renombrar</button>
              <button className="link danger" onClick={remove}>Borrar</button>
            </div>
          </div>

          <h3 className="sub">Fondos</h3>
          {funds.length === 0 && <p className="muted small">Añade fondos con el buscador o desde el catálogo.</p>}
          <ul className="sim-funds">
            {funds.map(({ f, p }, i) => (
              <li key={f.id}>
                <div className="sim-fund-name">
                  <a href={`#/?f=${encodeURIComponent(p.id)}`}>{p.name}</a>
                  <span className="muted small"><AssetTag p={p} /> {fmtPct(p.totalCost)} coste · {fmtPct(assumptions[i].netReturn)} neta/año</span>
                </div>
                <label className="weight">
                  <input type="number" min={0} max={100} step={1} value={f.weight}
                    onChange={(e) => setFund(f.id, { weight: Math.max(0, Number(e.target.value)) })} aria-label={`Peso de ${p.name}`} />
                  <span>%</span>
                </label>
                {sim.returnMode === 'personalizada' && (
                  <label className="weight" title="Rentabilidad bruta anual esperada">
                    <input type="number" step={0.5} value={f.customReturn ?? ''} placeholder="6"
                      onChange={(e) => setFund(f.id, { customReturn: e.target.value === '' ? undefined : Number(e.target.value) })}
                      aria-label={`Rentabilidad esperada de ${p.name}`} />
                    <span>%/año</span>
                  </label>
                )}
                <button className="icon-btn small-icon" onClick={() => removeFund(f.id)} aria-label={`Quitar ${p.name}`}>✕</button>
              </li>
            ))}
          </ul>
          {funds.length > 0 && (
            <div className="weights-foot">
              <span className={Math.abs(weightSum - 100) > 0.05 ? 'neg small' : 'muted small'}>
                Total: {fmtPct(weightSum, 1)}{Math.abs(weightSum - 100) > 0.05 && ' · se normaliza al 100 % para calcular'}
              </span>
              <button className="link" onClick={() => set({ funds: equalWeights(sim.funds) })}>Repartir a partes iguales</button>
            </div>
          )}
          <FundSearch exclude={sim.funds.map((f) => f.id)} onAdd={(id) => addFundToSim(sim.id, id)} />
        </div>

        <div className="panel">
          <h3 className="sub">Aportaciones y plazo</h3>
          <div className="form-grid">
            <Field label="Capital inicial" suffix="€" value={sim.initial} step={100} onChange={(v) => set({ initial: v })} />
            <Field label="Aportación mensual" suffix="€" value={sim.monthly} step={25} onChange={(v) => set({ monthly: v })} />
            <Field label="Subida anual de la aportación" suffix="%" value={sim.yearlyIncrease} step={0.5} onChange={(v) => set({ yearlyIncrease: v })} />
            <Field label="Inflación estimada" suffix="%" value={sim.inflation} step={0.1} onChange={(v) => set({ inflation: v })} />
            <Field label="Objetivo (opcional)" suffix="€" value={sim.goal ?? ''} step={1000} onChange={(v) => set({ goal: v || null })} />
          </div>
          <label className="range">
            <span>Plazo: <strong>{sim.years} años</strong></span>
            <input type="range" min={1} max={50} value={sim.years} onChange={(e) => set({ years: Number(e.target.value) })} />
          </label>

          <h3 className="sub">Hipótesis de rentabilidad</h3>
          <div className="segmented small-seg" role="radiogroup" aria-label="Hipótesis de rentabilidad">
            {MODES.map((m) => (
              <button key={m.id} role="radio" aria-checked={sim.returnMode === m.id} aria-selected={sim.returnMode === m.id}
                onClick={() => set({ returnMode: m.id })}>{m.label}</button>
            ))}
          </div>
          <p className="muted small">{MODES.find((m) => m.id === sim.returnMode)!.hint}</p>
        </div>
      </div>

      <div className="sim-main">
        {!funds.length || !last ? (
          <div className="panel sim-empty"><p className="muted">Añade al menos un fondo para ver la proyección.</p></div>
        ) : (
          <>
            <div className="sim-result panel">
              <p className="muted small">Valor estimado en {sim.years} años</p>
              <p className="sim-big">{fmtEur(last.value)}</p>
              <p className="muted">
                Entre <strong>{fmtEur(last.low)}</strong> y <strong>{fmtEur(last.high)}</strong> en escenarios desfavorable y favorable ·{' '}
                <strong>{fmtEur(last.real)}</strong> en euros de hoy
              </p>
              {sim.goal && (
                <p className={proj.goalYear ? 'pos' : 'neg'}>
                  {proj.goalYear ? `🎯 Alcanzarías tu objetivo de ${fmtEur(sim.goal)} en el año ${proj.goalYear}.` : `🎯 No alcanzarías ${fmtEur(sim.goal)} en ${sim.years} años en el escenario esperado.`}
                </p>
              )}
            </div>

            <div className="kpis">
              <Kpi label="Total aportado" value={fmtEur(last.contributed)} />
              <Kpi label="Rendimiento" value={fmtEur(last.value - last.contributed)}
                sub={`${fmtSignedPct(((last.value - last.contributed) / last.contributed) * 100)} sobre lo aportado`} />
              <Kpi label="Rentabilidad neta esperada" value={`${fmtPct(proj.netReturn)}/año`} sub={`Volatilidad aprox. ${fmtPct(proj.volatility, 0)}`} />
              <Kpi label="Coste de los fondos" value={fmtPct(proj.cost, 3)}
                sub={`Te costaría ${fmtEur(costImpact)} en ${sim.years} años`} />
            </div>

            <div className="panel">
              <div className="panel-head">
                <h2>Evolución</h2>
                <button className="link" onClick={download}>Descargar CSV</button>
              </div>
              <ProjectionChart
                label={`Proyección de la cartera ${sim.name} a ${sim.years} años`}
                points={[{ x: 0, label: 'Hoy', value: sim.initial, low: sim.initial, high: sim.initial, base: sim.initial },
                  ...proj.rows.map((r) => ({ x: r.year, label: `Año ${r.year}`, value: r.value, low: r.low, high: r.high, base: r.contributed }))]}
              />
              <p className="muted small">
                Escenarios: rentabilidad anualizada 1,28 desviaciones por debajo/encima de la esperada (aprox. 1 de cada 10 casos peor o mejor).
                Simulación orientativa: no incluye impuestos y supone rebalanceo continuo.
              </p>
            </div>

            <div className="panel">
              <div className="panel-head">
                <h2>Año a año</h2>
                <button className="link" aria-expanded={showTable} onClick={() => setShowTable((s) => !s)}>{showTable ? 'Ocultar' : 'Mostrar tabla'}</button>
              </div>
              {showTable && (
                <div className="table-wrap flat">
                  <table className="years">
                    <thead>
                      <tr><th>Año</th><th className="num">Aportado</th><th className="num">Valor esperado</th><th className="num">Desfavorable</th><th className="num">Favorable</th><th className="num">Euros de hoy</th></tr>
                    </thead>
                    <tbody>
                      {proj.rows.map((r) => (
                        <tr key={r.year} className={sim.goal && r.year === proj.goalYear ? 'goal-row' : ''}>
                          <td>{r.year}</td>
                          <td className="num">{fmtEur(r.contributed)}</td>
                          <td className="num"><strong>{fmtEur(r.value)}</strong></td>
                          <td className="num">{fmtEur(r.low)}</td>
                          <td className="num">{fmtEur(r.high)}</td>
                          <td className="num">{fmtEur(r.real)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function FundSearch({ exclude, onAdd }: { exclude: string[]; onAdd: (id: string) => void }) {
  const [q, setQ] = useState('');
  const results = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (t.length < 2) return [];
    return catalog.items
      .filter((p) => !exclude.includes(p.id) && [p.name, p.isin, p.index, p.ticker].some((v) => v?.toLowerCase().includes(t)))
      .sort((a, b) => (a.totalCost ?? 9) - (b.totalCost ?? 9))
      .slice(0, 8);
  }, [q, exclude]);
  return (
    <div className="fund-search">
      <input type="search" placeholder="Añadir fondo: nombre, ISIN o índice…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar fondo para añadir" />
      {results.length > 0 && (
        <ul className="similar">
          {results.map((p) => (
            <li key={p.id}>
              <button className="similar-item" onClick={() => { onAdd(p.id); setQ(''); }}>
                <span><AssetTag p={p} /> {p.name} <span className="muted small">{p.type === 'etf' ? 'ETF' : p.type === 'plan' ? 'Plan' : ''}</span></span>
                <span className="num">{fmtPct(p.totalCost)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Field({ label, suffix, value, step, onChange }: { label: string; suffix: string; value: number | ''; step: number; onChange: (v: number) => void }) {
  return (
    <label className="field">
      <span className="muted small">{label}</span>
      <span className="field-input">
        <input type="number" inputMode="decimal" min={0} step={step} value={value}
          onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))} />
        <span className="muted">{suffix}</span>
      </span>
    </label>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="kpi">
      <div className="muted small">{label}</div>
      <div className="kpi-value">{value}</div>
      {sub && <div className="small muted">{sub}</div>}
    </div>
  );
}
