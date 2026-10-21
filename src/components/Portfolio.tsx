import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { byIsin, cheaperAlternative } from '../data';
import { fmtDate, fmtEur, fmtEur0, fmtPct, fmtSignedEur, fmtSignedPct } from '../format';
import { externalProduct, type Holding, LOOKUP_VERSION, loadHoldings, lookupFundInfo, needsLookup, parseHoldingCsv, saveHoldings, sum, totals } from '../portfolio';
import { assetTypeSlices, blend, projectFrom } from '../simulate';
import type { ReturnMode } from '../sims';
import type { Product } from '../types';
import { BarList, Donut, TimelineChart } from './Charts';


const HORIZON_YEARS = 20;

// ISINs already looked up during this page load (module-level so remounts don't repeat requests).
const attempted = new Set<string>();

export function Portfolio() {
  const [holdings, setHoldings] = useState<Holding[]>(loadHoldings);
  const [errors, setErrors] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [removed, setRemoved] = useState<{ holding: Holding; index: number } | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => saveHoldings(holdings), [holdings]);

  // Identify funds missing from the catalog by ISIN (only the ISIN is sent; see lookupFundInfo).
  const [looking, setLooking] = useState<string[]>([]);
  useEffect(() => {
    const pending = holdings.filter((h) => needsLookup(h, byIsin.has(h.isin)) && !attempted.has(h.isin)).map((h) => h.isin);
    if (!pending.length) return;
    pending.forEach((isin) => attempted.add(isin));
    setLooking((cur) => [...cur, ...pending]);
    for (const isin of pending) {
      lookupFundInfo(isin)
        .then((info) => setHoldings((cur) => cur.map((h) => (h.isin === isin ? { ...h, info, infoCheckedAt: new Date().toISOString(), infoVersion: LOOKUP_VERSION } : h))))
        .catch(() => { /* offline or API down: retried on the next page load */ })
        .finally(() => setLooking((cur) => cur.filter((i) => i !== isin)));
    }
  }, [holdings]);
  useEffect(() => {
    if (!removed) return;
    const t = setTimeout(() => setRemoved(null), 8000);
    return () => clearTimeout(t);
  }, [removed]);

  async function importFiles(files: FileList | File[]) {
    const errs: string[] = [];
    const parsed: Holding[] = [];
    for (const f of Array.from(files)) {
      try {
        parsed.push(parseHoldingCsv(f.name, await f.text()));
      } catch (e) {
        errs.push((e as Error).message);
      }
    }
    setErrors(errs);
    if (parsed.length) {
      setHoldings((cur) => [
        ...cur.filter((h) => !parsed.some((p) => p.isin === h.isin)),
        ...parsed.map((p) => ({ ...p, name: cur.find((h) => h.isin === p.isin)?.name })),
      ]);
    }
  }

  const rows = useMemo(
    () =>
      holdings
        .map((h) => {
          const catalogProduct = byIsin.get(h.isin);
          const product = catalogProduct ?? (h.info ? externalProduct(h.info) : undefined);
          const name = catalogProduct?.name ?? h.name ?? h.info?.name ?? h.isin;
          return { h, product, external: !catalogProduct && !!h.info, name, alternative: cheaperAlternative(catalogProduct), ...totals(h.lots) };
        })
        .sort((a, b) => b.value - a.value),
    [holdings],
  );
  const all = totals(holdings.flatMap((h) => h.lots));
  const known = rows.filter((r) => r.product?.totalCost != null);
  const weightedCost = known.length ? sum(known.map((r) => r.value * r.product!.totalCost!)) / sum(known.map((r) => r.value)) : null;

  // Yearly cost saved by switching every position that has a cheaper same-index fund.
  const savings = sum(rows.map((r) => (r.alternative ? (r.value * (r.product!.totalCost! - r.alternative.totalCost!)) / 100 : 0)));
  const switchable = rows.filter((r) => r.alternative).length;

  const contributions = useMemo(() => {
    const byDate = new Map<string, number>();
    for (const l of holdings.flatMap((h) => h.lots)) byDate.set(l.date, (byDate.get(l.date) ?? 0) + l.invested);
    let acc = 0;
    return [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, v]) => ({ date, value: (acc += v) }));
  }, [holdings]);

  // ---- Projection to 20 years after the first contribution ----
  const [mode, setMode] = useState<Exclude<ReturnMode, 'personalizada'>>('prudente');
  const [monthlyInput, setMonthlyInput] = useState<number | null>(null);
  const [view, setView] = useState<'proyeccion' | 'historico'>('proyeccion');
  const firstDate = contributions.length ? new Date(contributions[0].date) : new Date();
  const horizon = new Date(firstDate);
  horizon.setFullYear(horizon.getFullYear() + HORIZON_YEARS);
  const now = new Date();
  const monthsLeft = Math.max(0, (horizon.getFullYear() - now.getFullYear()) * 12 + horizon.getMonth() - now.getMonth());
  // Default monthly contribution: what was invested over the last 12 months (first purchase excluded, it is usually a lump sum).
  const avgMonthly = useMemo(() => {
    const lots = holdings.flatMap((h) => h.lots).filter((l) => l.date !== contributions[0]?.date);
    const since = new Date(now); since.setFullYear(since.getFullYear() - 1);
    const recent = lots.filter((l) => new Date(l.date) >= since);
    const months = Math.min(12, Math.max(1, Math.round((now.getTime() - firstDate.getTime()) / (30.44 * 86_400_000))));
    return Math.round(sum(recent.map((l) => l.invested)) / months);
  }, [holdings]); // depends only on the imported lots
  const monthly = monthlyInput ?? avgMonthly;
  const assumptions = blend(
    rows.map((r) => ({ product: r.product ?? ({ id: r.h.isin, type: 'fondo', isin: r.h.isin, name: r.name, assetClass: null, region: null, totalCost: 0, addedAt: null } satisfies Product), amount: r.value })),
    mode,
  );
  const future = useMemo(
    () => projectFrom({ start: all.value, startDate: now, contributed: all.invested, monthly, months: monthsLeft, ...assumptions }),
    [all.value, all.invested, monthly, monthsLeft, assumptions.netReturn, assumptions.volatility],
  );
  const end = future.at(-1);

  const byRegion = useMemo(() => {
    const groups = new Map<string, number>();
    for (const r of rows) {
      const key = r.product?.region ?? 'Sin clasificar';
      groups.set(key, (groups.get(key) ?? 0) + r.value);
    }
    return [...groups.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  }, [rows]);
  const byFund = rows.map((r) => ({ label: r.name, value: r.value }));
  const byType = assetTypeSlices(rows.map((r) => ({ product: r.product, amount: r.value })));

  const rename = (isin: string, current?: string) => {
    const name = prompt('Nombre para este fondo (solo se guarda en tu navegador):', current ?? '')?.trim();
    if (name != null) setHoldings((cur) => cur.map((h) => (h.isin === isin ? { ...h, name: name || undefined } : h)));
  };

  const remove = (isin: string) => {
    const index = holdings.findIndex((h) => h.isin === isin);
    if (index < 0) return;
    setRemoved({ holding: holdings[index], index });
    setHoldings(holdings.filter((h) => h.isin !== isin));
  };
  const undoRemove = () => {
    if (!removed) return;
    setHoldings((cur) => [...cur.slice(0, removed.index), removed.holding, ...cur.slice(removed.index)]);
    setRemoved(null);
  };

  const clear = () => {
    if (confirm('¿Borrar todos los datos de tu cartera de este navegador?')) {
      setHoldings([]);
      setErrors([]);
      setRemoved(null);
    }
  };

  return (
    <section>
      <div className="hero hero-compact">
        <div className="hero-text">
          <p className="eyebrow">Área personal</p>
          <h1>Mi cartera</h1>
          <p className="muted">
            Importa los CSV de <em>plusvalías y minusvalías</em> de cada fondo (uno por fondo; el ISIN se toma del nombre del archivo)
            y sigue su evolución, su reparto y sus costes.
          </p>
        </div>
        <p className="privacy">
          <span aria-hidden>🔒</span> Tus datos se procesan y guardan <strong>solo en este navegador</strong> y puedes borrarlos cuando quieras.
          Para identificar fondos que no están en el catálogo se consulta <strong>solo su ISIN</strong> (vía FT.com); nunca importes ni movimientos.
        </p>
      </div>

      <div
        className={`dropzone${dragging ? ' dragging' : ''}${rows.length ? ' compact' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); importFiles(e.dataTransfer.files); }}
      >
        {rows.length ? (
          <>
            <button className="btn" onClick={() => input.current?.click()}>Añadir o actualizar CSV</button>
            <span className="muted small">o arrástralos aquí. Reimportar un fondo sustituye sus datos.</span>
          </>
        ) : (
          <>
            <p><strong>Arrastra aquí tus CSV</strong> o</p>
            <button className="btn" onClick={() => input.current?.click()}>Seleccionar archivos</button>
            <p className="muted small">Formato: <code>Fecha fiscal;Inversión;Valor de mercado;Resultado fiscal</code>. Reimportar un fondo sustituye sus datos.</p>
          </>
        )}
        <input ref={input} type="file" accept=".csv,text/csv" multiple hidden
          onChange={(e) => { if (e.target.files) importFiles(e.target.files); e.target.value = ''; }} />
      </div>

      {removed && (
        <div className="toast" role="status">
          Has quitado «{byIsin.get(removed.holding.isin)?.name ?? removed.holding.name ?? removed.holding.isin}».
          <button className="link" onClick={undoRemove}>Deshacer</button>
        </div>
      )}

      {errors.length > 0 && (
        <ul className="errors" role="alert">{errors.map((e) => <li key={e}>{e}</li>)}</ul>
      )}

      {rows.length > 0 && (
        <>
          <div className="kpis">
            <Kpi label="Valor de mercado" value={fmtEur(all.value)} />
            <Kpi label="Invertido" value={fmtEur(all.invested)} />
            <Kpi
              label="Resultado"
              value={fmtSignedEur(all.result)}
              sub={fmtSignedPct(all.pct)}
              tone={all.result >= 0 ? 'pos' : 'neg'}
            />
            <Kpi label="Coste medio ponderado" value={fmtPct(weightedCost, 3)} sub={known.length === rows.length ? `${rows.length} fondos` : `${known.length} de ${rows.length} fondos con coste conocido`} />
            {switchable > 0 && (
              <Kpi
                wide
                label="Ahorro posible en costes"
                value={`${fmtEur(savings)}/año`}
                sub={`Traspasando ${switchable} ${switchable === 1 ? 'fondo' : 'fondos'} a otro del mismo índice más barato`}
              />
            )}
          </div>

          <div className="panel composition-panel">
            <div className="panel-head">
              <h2>Aportado frente a valor</h2>
              <div className="head-controls">
              {end && (
                <div className="segmented small-seg" role="radiogroup" aria-label="Periodo de la gráfica">
                  {(['proyeccion', 'historico'] as const).map((v) => (
                    <button key={v} role="radio" aria-checked={view === v} aria-selected={view === v} onClick={() => setView(v)}>
                      {v === 'proyeccion' ? `Proyección a ${HORIZON_YEARS} años` : 'Solo histórico'}
                    </button>
                  ))}
                </div>
              )}
              {view === 'proyeccion' && end && (
              <div className="segmented small-seg" role="radiogroup" aria-label="Hipótesis de rentabilidad">
                {(['prudente', 'historica'] as const).map((m) => (
                  <button key={m} role="radio" aria-checked={mode === m} aria-selected={mode === m} onClick={() => setMode(m)}>
                    {m === 'prudente' ? 'Prudente' : 'Histórica 5 años'}
                  </button>
                ))}
              </div>
              )}
              </div>
            </div>
            <p className="muted">
              Hoy: aportado <strong>{fmtEur(all.invested)}</strong>, valor <strong>{fmtEur(all.value)}</strong>{' '}
              <span className={all.result >= 0 ? 'pos' : 'neg'}>({fmtSignedEur(all.result)})</span>.
              {end && (
                <> Estimación a {horizon.getFullYear()} ({HORIZON_YEARS} años desde tu primera aportación):{' '}
                  <strong>{fmtEur0(end.value)}</strong> esperado, entre {fmtEur0(end.low)} y {fmtEur0(end.high)}, habiendo aportado {fmtEur0(end.contributed)}.</>
              )}
            </p>
            {end && view === 'proyeccion' && (
              <div className="projection-controls">
                <label className="field">
                  <span className="muted small">Aportación mensual a partir de hoy</span>
                  <span className="field-input">
                    <input type="number" min={0} step={10} value={monthly}
                      onChange={(e) => setMonthlyInput(Math.max(0, Number(e.target.value) || 0))} />
                    <span className="muted">€</span>
                  </span>
                </label>
                <span className="muted small">
                  {monthlyInput == null ? `Tu media de los últimos 12 meses. ` : <><button className="link" onClick={() => setMonthlyInput(null)}>Volver a tu media ({fmtEur0(avgMonthly)})</button>. </>}
                  Rentabilidad neta estimada {fmtPct(assumptions.netReturn)}/año con los costes de tus fondos.
                </span>
              </div>
            )}
            <TimelineChart
              label={`Aportado frente a valor de la cartera${end ? ` y estimación hasta ${horizon.getFullYear()}` : ''}`}
              past={contributions.map((c) => ({ t: new Date(c.date).getTime(), contributed: c.value }))}
              today={{ t: now.getTime(), contributed: all.invested, value: all.value }}
              future={view === 'proyeccion' ? future : []}
            />
            <p className="muted small">
              El CSV solo incluye el valor actual de cada lote, así que el valor pasado no se muestra; lo aportado sí es real.
              {end && ' La estimación supone aportaciones constantes, no incluye impuestos y es orientativa.'}
              {!end && ` Tu cartera ya supera los ${HORIZON_YEARS} años, por eso no se proyecta.`}
            </p>
          </div>

          <div className="panel composition-panel">
            <h2 className="panel-title">Composición</h2>
            <div className="composition">
              <Donut title="Por fondo" slices={byFund} format={fmtEur} center={{ label: 'Valor', value: fmtEur0(all.value) }} />
              <Donut title="Por tipo de activo" slices={byType} format={fmtEur} center={{ label: 'Renta variable', value: fmtPct((sum(byType.filter((t) => t.label === 'Renta variable').map((t) => t.value)) / all.value) * 100, 0) }} />
              <figure className="donut">
                <figcaption className="donut-title">Por región / plazo</figcaption>
                <BarList items={byRegion} />
              </figure>
            </div>
          </div>

          <div className="panel">
            <div className="panel-head">
              <h2>Posiciones</h2>
              <button className="btn btn-danger" onClick={clear}>Borrar mis datos</button>
            </div>
            <div className="table-wrap">
              <table className="positions">
                <thead>
                  <tr>
                    <th>Fondo</th>
                    <th className="num">Invertido</th>
                    <th className="num">Valor</th>
                    <th className="num">Resultado</th>
                    <th className="num">Peso</th>
                    <th className="num">Coste</th>
                    <th aria-label="Acciones" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const link = r.external ? r.h.info?.url : r.product && `#/?f=${encodeURIComponent(r.product.id)}`;
                    const isOpen = open === r.h.isin;
                    return (
                      <Fragment key={r.h.isin}>
                        <tr>
                          <td data-label="Fondo" className="name-cell">
                            <div className="name">
                              {link ? <a href={link} {...(r.external ? { target: '_blank', rel: 'noreferrer' } : {})}>{r.name}</a> : r.name}
                              {r.external && <span className="badge-ext" title={`Datos obtenidos de ${r.h.info!.source} a partir del ISIN`}>vía {r.h.info!.source}</span>}
                            </div>
                            <div className="muted small">
                              <span className="mono">{r.h.isin}</span>
                              {r.product?.region && <span> · {r.product.region}</span>}
                              {!byIsin.has(r.h.isin) && (
                                <span>
                                  {' '}· {looking.includes(r.h.isin) ? 'Buscando datos del fondo…'
                                    : r.external ? 'No está en el catálogo'
                                    : 'No está en el catálogo ni se ha podido identificar'} ·{' '}
                                  <button className="link" onClick={() => rename(r.h.isin, r.h.name)}>
                                    {r.h.name ? 'Renombrar' : 'Ponerle nombre'}
                                  </button>
                                </span>
                              )}
                            </div>
                            {r.alternative && (
                              <div className="alt small">
                                <span aria-hidden>💡</span> Mismo índice más barato:{' '}
                                <a href={`#/?f=${encodeURIComponent(r.alternative.id)}`}>{r.alternative.name}</a>{' '}
                                ({fmtPct(r.alternative.totalCost)} frente a {fmtPct(r.product!.totalCost)}
                                {r.alternative.platforms?.length ? `; en ${r.alternative.platforms.join(', ')}` : ''})
                              </div>
                            )}
                          </td>
                          <td data-label="Invertido" className="num">{fmtEur(r.invested)}</td>
                          <td data-label="Valor" className="num">{fmtEur(r.value)}</td>
                          <td data-label="Resultado" className={`num ${r.result >= 0 ? 'pos' : 'neg'}`}>
                            {fmtSignedEur(r.result)}<div className="small">{fmtSignedPct(r.pct)}</div>
                          </td>
                          <td data-label="Peso" className="num">{fmtPct((r.value / all.value) * 100, 1)}</td>
                          <td data-label="Coste" className="num">{fmtPct(r.product?.totalCost)}</td>
                          <td className="actions">
                            <button className="link" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : r.h.isin)}>
                              {isOpen ? 'Ocultar' : `${r.h.lots.length} lotes`}
                            </button>
                            <button className="link" onClick={() => remove(r.h.isin)}>
                              Quitar
                            </button>
                          </td>
                        </tr>
                        {isOpen && (
                          <tr className="lots-row">
                            <td colSpan={7}>
                              <Lots holding={r.h} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function Kpi({ label, value, sub, tone, wide }: { label: string; value: string; sub?: string; tone?: 'pos' | 'neg'; wide?: boolean }) {
  return (
    <div className={`kpi${wide ? ' kpi-wide' : ''}`}>
      <div className="muted small">{label}</div>
      <div className={`kpi-value ${tone ?? ''}`}>{value}</div>
      {sub && <div className={`small ${tone ?? 'muted'}`}>{sub}</div>}
    </div>
  );
}

function Lots({ holding }: { holding: Holding }) {
  const losing = holding.lots.filter((l) => l.result < 0);
  return (
    <div className="lots">
      <p className="muted small">
        {holding.lots.length} lotes (FIFO) · {losing.length} en pérdidas por {fmtEur(-sum(losing.map((l) => l.result)))} ·
        importado de «{holding.fileName}» el {fmtDate(holding.importedAt)}
      </p>
      <table>
        <thead>
          <tr><th>Fecha fiscal</th><th className="num">Inversión</th><th className="num">Valor</th><th className="num">Resultado</th></tr>
        </thead>
        <tbody>
          {holding.lots.map((l, i) => (
            <tr key={i}>
              <td>{fmtDate(l.date)}</td>
              <td className="num">{fmtEur(l.invested)}</td>
              <td className="num">{fmtEur(l.value)}</td>
              <td className={`num ${l.result >= 0 ? 'pos' : 'neg'}`}>{fmtSignedEur(l.result)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
