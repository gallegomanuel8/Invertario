import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { byIsin, cheaperAlternative } from '../data';
import { fmtDate, fmtEur, fmtEur0, fmtPct, fmtSignedEur, fmtSignedPct } from '../format';
import { detectTransfers, externalProduct, fetchNavs, type Folio, type Holding, loadFolios, LOOKUP_VERSION, lookupFundInfo, mergeImport, navFactor, needsLookup, newFolioId, parseCsvFile, pricesStale, saveFolios, sum, totals, type Transfer, withLiveValues } from '../portfolio';
import { assetTypeSlices, blend, projectFrom } from '../simulate';
import type { ReturnMode } from '../sims';
import type { Product } from '../types';
import { OPEN_DATA_EVENT } from '../backup';
import { AssetTag, useDismissDetails } from './bits';
import { BarList, Donut, TimelineChart } from './Charts';


const HORIZON_YEARS = 20;
const fmtShares = (n: number) => n.toLocaleString('es-ES', { maximumFractionDigits: 6 });

// Holdings (ISIN@import) whose prices were already requested during this page load (forced refreshes ignore it).
const priceAttempted = new Set<string>();

// ISINs already looked up during this page load (module-level so remounts don't repeat requests).
const attempted = new Set<string>();

const readFolioId = () => decodeURIComponent(location.hash.match(/^#\/cartera\/([\w-]+)/)?.[1] ?? '');

export function Portfolio() {
  const [folios, setFolios] = useState<Folio[]>(loadFolios);
  const [activeId, setActiveId] = useState(readFolioId);
  const folio = folios.find((f) => f.id === activeId) ?? folios[0];
  const holdings = folio.holdings;
  // Updates the holdings of the portfolio that was active when the update was scheduled.
  const folioId = folio.id;
  const setHoldings = (upd: Holding[] | ((cur: Holding[]) => Holding[])) =>
    setFolios((fs) => fs.map((f) => (f.id === folioId ? { ...f, holdings: typeof upd === 'function' ? upd(f.holdings) : upd } : f)));
  const [errors, setErrors] = useState<string[]>([]);
  const [notices, setNotices] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [removed, setRemoved] = useState<{ holding: Holding; index: number } | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => saveFolios(folios), [folios]);

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

  // Live values: refresh NAVs automatically when older than PRICE_TTL_MS, or on demand (sends only ISIN + a date).
  const [refreshing, setRefreshing] = useState(false);
  const refreshPrices = async (force: boolean) => {
    // keyed by import too: a re-imported CSV needs prices for its own date
    const key = (h: Holding) => `${h.isin}@${h.importedAt}`;
    const targets = holdings.filter((h) => force || (pricesStale(h) && !priceAttempted.has(key(h))));
    if (!targets.length) return;
    targets.forEach((h) => priceAttempted.add(key(h)));
    setRefreshing(true);
    const results = await Promise.allSettled(targets.map((h) => fetchNavs(h).then((r) => ({ isin: h.isin, ...r }))));
    const ok = new Map(results.flatMap((r) => (r.status === 'fulfilled' ? [[r.value.isin, r.value] as const] : [])));
    const now = new Date().toISOString();
    setHoldings((cur) => cur.map((h) => {
      const r = ok.get(h.isin);
      // baseNav is fixed at the first successful lookup after an import; only the current NAV moves.
      if (r) return { ...h, nav: r.nav, baseNav: h.baseNav ?? r.baseNav, navCheckedAt: now };
      // failed lookups also wait PRICE_TTL_MS before retrying automatically
      return targets.some((t) => t.isin === h.isin) ? { ...h, navCheckedAt: now } : h;
    }));
    setRefreshing(false);
  };
  useEffect(() => { refreshPrices(false); }, [holdings.map((h) => h.isin + h.importedAt).join()]); // new or re-imported funds

  useEffect(() => {
    if (!removed) return;
    const t = setTimeout(() => setRemoved(null), 8000);
    return () => clearTimeout(t);
  }, [removed]);

  async function importFiles(files: FileList | File[]) {
    const errs: string[] = [];
    const parsed: Holding[] = [];
    const skipped: string[] = [];
    for (const f of Array.from(files)) {
      try {
        const r = parseCsvFile(f.name, await f.text(), f.lastModified);
        parsed.push(...r.holdings);
        skipped.push(...r.skipped);
      } catch (e) {
        errs.push((e as Error).message);
      }
    }
    setErrors(errs);
    const skippedNote = skipped.length ? `No se pueden seguir sin cotización por ISIN (criptomonedas compradas directamente): ${skipped.join(', ')}.` : null;
    if (!parsed.length) return setNotices(skippedNote ? [skippedNote] : []);
    const { holdings: next, duplicates, stale } = mergeImport(holdings, parsed);
    const notes: string[] = [];
    if (duplicates) notes.push(`${duplicates === 1 ? 'Un fondo venía' : `${duplicates} fondos venían`} en dos archivos (p. ej. «… 2.csv»): se ha usado el más reciente.`);
    if (stale.length) notes.push(`${stale.length === 1 ? `«${stale[0]}» es más antiguo` : `${stale.length} archivos son más antiguos`} que lo ya importado: se mantiene lo actual.`);
    if (skippedNote) notes.push(skippedNote);
    setNotices(notes);
    setHoldings(next);
  }

  // Funds transferred to another fund stay stored (to measure the transfer) but leave the totals.
  const transfers = useMemo(() => detectTransfers(holdings), [holdings]);
  const active = useMemo(() => holdings.filter((h) => !transfers.some((t) => t.from === h)), [holdings, transfers]);

  const rows = useMemo(
    () =>
      active
        .map((h) => {
          const catalogProduct = byIsin.get(h.isin);
          const product = catalogProduct ?? (h.info ? externalProduct(h.info) : undefined);
          const name = catalogProduct?.name ?? h.name ?? h.info?.name ?? h.isin;
          const live = withLiveValues(h);
          return {
            h, live, product, external: !catalogProduct && !!h.info, name, alternative: cheaperAlternative(catalogProduct),
            sinceCsv: (navFactor(h) - 1) * 100, ...totals(live.lots),
          };
        })
        .sort((a, b) => b.value - a.value),
    [active],
  );
  const all = totals(rows.flatMap((r) => r.live.lots));
  const latestNav = rows.map((r) => r.h.nav?.date).filter(Boolean).sort().at(-1);
  const updated = rows.filter((r) => navFactor(r.h) !== 1).length;
  const noPrice = rows.filter((r) => r.h.navCheckedAt && !r.h.nav).map((r) => r.h.isin);
  const known = rows.filter((r) => r.product?.totalCost != null);
  const weightedCost = known.length ? sum(known.map((r) => r.value * r.product!.totalCost!)) / sum(known.map((r) => r.value)) : null;

  // Yearly cost saved by switching every position that has a cheaper same-index fund.
  const savings = sum(rows.map((r) => (r.alternative ? (r.value * (r.product!.totalCost! - r.alternative.totalCost!)) / 100 : 0)));
  const switchable = rows.filter((r) => r.alternative).length;

  const contributions = useMemo(() => {
    const byDate = new Map<string, number>();
    for (const l of active.flatMap((h) => h.lots)) byDate.set(l.date, (byDate.get(l.date) ?? 0) + l.invested);
    let acc = 0;
    return [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, v]) => ({ date, value: (acc += v) }));
  }, [active]);

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
    const lots = active.flatMap((h) => h.lots).filter((l) => l.date !== contributions[0]?.date);
    const since = new Date(now); since.setFullYear(since.getFullYear() - 1);
    const recent = lots.filter((l) => new Date(l.date) >= since);
    const months = Math.min(12, Math.max(1, Math.round((now.getTime() - firstDate.getTime()) / (30.44 * 86_400_000))));
    return Math.round(sum(recent.map((l) => l.invested)) / months);
  }, [active]); // depends only on the imported lots
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
    if (confirm(`¿Borrar los fondos de «${folio.name}» de este navegador? Tus otras carteras y las simuladas no se tocan. No se puede deshacer: exporta antes una copia si la quieres conservar.`)) {
      setHoldings([]);
      setErrors([]);
      setNotices([]);
      setRemoved(null);
    }
  };

  // ---- Several portfolios ----
  const selectFolio = (id: string) => {
    setActiveId(id);
    setErrors([]); setNotices([]); setRemoved(null); setOpen(null); setMonthlyInput(null);
    history.replaceState(null, '', `#/cartera/${id}`);
  };
  const newFolio = () => {
    const name = prompt('Nombre de la nueva cartera:', `Cartera ${folios.length + 1}`)?.trim();
    if (!name) return;
    const f: Folio = { id: newFolioId(), name, holdings: [] };
    setFolios((fs) => [...fs, f]);
    selectFolio(f.id);
  };
  const renameFolio = () => {
    const name = prompt('Nuevo nombre de la cartera:', folio.name)?.trim();
    if (name) setFolios((fs) => fs.map((f) => (f.id === folio.id ? { ...f, name } : f)));
  };
  const deleteFolio = (target: Folio) => {
    if (folios.length < 2) return;
    const n = target.holdings.length;
    if (!confirm(`¿Eliminar la cartera «${target.name}»${n ? ` y sus ${n} ${n === 1 ? 'fondo' : 'fondos'}` : ''} de este navegador? No se puede deshacer: exporta antes una copia si la quieres conservar.`)) return;
    const rest = folios.filter((f) => f.id !== target.id);
    setFolios(rest);
    if (target.id === folio.id) selectFolio(rest[0].id);
  };
  const markNotTransfer = (t: Transfer) =>
    setHoldings((cur) => cur.map((h) => (h === t.from ? { ...h, notTransferTo: [...(h.notTransferTo ?? []), t.to.isin] } : h)));
  const productName = (h: Holding) => byIsin.get(h.isin)?.name ?? h.name ?? h.info?.name ?? h.isin;

  const privacyRef = useRef<HTMLDetailsElement>(null);
  useDismissDetails(privacyRef);

  const folioBar = folios.length > 1 && (
    <div className="folio-bar">
      <div className="sim-tabs" role="tablist" aria-label="Tus carteras">
        {folios.map((f) => (
          <span key={f.id} className={`folio-tab${f.id === folio.id ? ' active' : ''}`}>
            <button role="tab" aria-selected={f.id === folio.id} onClick={() => selectFolio(f.id)}>
              {f.name} <span className="count">{f.holdings.length - detectTransfers(f.holdings).length}</span>
            </button>
            <button className="folio-del" onClick={() => deleteFolio(f)} aria-label={`Eliminar la cartera ${f.name}`} title="Eliminar esta cartera">✕</button>
          </span>
        ))}
      </div>
      <span className="folio-actions small">
        <button className="link" onClick={renameFolio}>Renombrar «{folio.name}»</button>
      </span>
    </div>
  );

  return (
    <section
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false); }}
      onDrop={(e) => { e.preventDefault(); setDragging(false); importFiles(e.dataTransfer.files); }}
    >
      <input ref={input} type="file" accept=".csv,text/csv" multiple hidden
        onChange={(e) => { if (e.target.files) importFiles(e.target.files); e.target.value = ''; }} />
      {rows.length ? (
        // With a portfolio loaded, the intro and the drop zone give way to a slim header.
        <>
          <div className="page-head">
            <h1>{folios.length > 1 ? 'Mis carteras' : folio.name}</h1>
            <div className="page-head-actions">
              <button className="btn btn-sm" onClick={newFolio} title="Sigue otra cartera por separado (por ejemplo, la de otra persona o de otro bróker)">+ Cartera</button>
              <button className="btn btn-sm" onClick={() => input.current?.click()} title="También puedes arrastrarlos a la página. Reimportar un fondo sustituye sus datos.">
                + Añadir CSV
              </button>
              <details className="privacy-pop" ref={privacyRef}>
                <summary className="btn btn-sm"><span aria-hidden>🔒</span> Privacidad</summary>
                <div className="privacy-pop-body">
                  <PrivacyText />
                </div>
              </details>
            </div>
            {dragging && <div className="drop-overlay" aria-hidden>Suelta los CSV para importarlos</div>}
          </div>
          {folioBar}
        </>
      ) : (
        <>
          <div className="hero hero-compact">
            <div className="hero-text">
              <p className="eyebrow">Área personal</p>
              <h1>{folio.name}</h1>
              <p className="muted">
                Importa los CSV de <em>plusvalías y minusvalías</em> de cada fondo (uno por fondo; el ISIN se toma del nombre del archivo)
                y sigue su evolución, su reparto y sus costes.
              </p>
            </div>
            <p className="privacy"><PrivacyText /></p>
          </div>
          {folioBar}
          <div className={`dropzone${dragging ? ' dragging' : ''}`}>
            <p><strong>Arrastra aquí tus CSV</strong> o</p>
            <button className="btn" onClick={() => input.current?.click()}>Seleccionar archivos</button>
            <p className="muted small">Formato: <code>Fecha fiscal;Inversión;Valor de mercado;Resultado fiscal</code>. Reimportar un fondo sustituye sus datos.</p>
            {folios.length === 1 && (
              <p className="muted small">¿Sigues más de una cartera? <button className="link" onClick={newFolio}>Crea otra</button> y llévalas por separado.</p>
            )}
          </div>
        </>
      )}

      {removed && (
        <div className="toast" role="status">
          Has quitado «{byIsin.get(removed.holding.isin)?.name ?? removed.holding.name ?? removed.holding.isin}».
          <button className="link" onClick={undoRemove}>Deshacer</button>
        </div>
      )}

      {rows.length > 0 && (
        <div className="price-status" role="status">
          <span>
            {refreshing ? 'Actualizando valores con el último valor liquidativo…'
              : latestNav ? <>Valores actualizados con el valor liquidativo del <strong>{fmtDate(latestNav)}</strong>{updated < rows.length && ` (${updated} de ${rows.length} fondos)`}.</>
              : 'Valores del CSV importado.'}
            {!refreshing && noPrice.length > 0 && <span className="muted"> {noPrice.length === 1 ? '1 fondo sin precio' : `${noPrice.length} fondos sin precio`}: se usa el valor del CSV.</span>}
          </span>
          <button className="btn" onClick={() => refreshPrices(true)} disabled={refreshing}>
            {refreshing ? 'Actualizando…' : 'Actualizar valores'}
          </button>
        </div>
      )}

      {errors.length > 0 && (
        <ul className="errors" role="alert">{errors.map((e) => <li key={e}>{e}</li>)}</ul>
      )}
      {notices.length > 0 && (
        <ul className="notices" role="status">{notices.map((n) => <li key={n}>{n}</li>)}</ul>
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

          {transfers.length > 0 && (
            <div className="panel transfers">
              <h2 className="panel-title">Traspasos detectados</h2>
              {transfers.map((t) => <TransferCard key={t.from.isin + t.to.isin} t={t} name={productName} onDismiss={() => markNotTransfer(t)} />)}
            </div>
          )}

          <div className="panel">
            <div className="panel-head">
              <h2>Posiciones</h2>
              <button className="btn btn-danger" onClick={clear}>Borrar cartera</button>
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
                              {r.product?.assetClass && <><AssetTag p={r.product} />{' '}</>}
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
                            {byIsin.get(r.h.isin)?.platforms?.length ? (
                              <div className="platforms pos-platforms" aria-label="Disponible en">
                                {byIsin.get(r.h.isin)!.platforms!.map((pl) => <span key={pl} className="pill">{pl}</span>)}
                              </div>
                            ) : byIsin.has(r.h.isin) ? null : r.h.broker ? (
                              <div className="muted small pos-platforms">Comprado en {r.h.broker}</div>
                            ) : (
                              <div className="muted small pos-platforms">Plataformas: sin datos (fondo fuera del catálogo)</div>
                            )}
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
                          <td data-label="Valor" className="num">
                            {fmtEur(r.value)}
                            {r.h.broker && r.h.nav?.currency === 'EUR' ? (
                              <div className="small muted" title={`Cotización de ${fmtDate(r.h.nav.date)}`}>
                                {fmtShares(sum(r.h.lots.map((l) => l.shares ?? 0)))} × {fmtEur(r.h.nav.price)}
                              </div>
                            ) : r.sinceCsv !== 0 && r.h.baseNav && (
                              <div className="small muted" title={`Valor liquidativo ${r.h.baseNav!.price} → ${r.h.nav!.price} ${r.h.nav!.currency} (${fmtDate(r.h.baseNav!.date)} → ${fmtDate(r.h.nav!.date)})`}>
                                {fmtSignedPct(r.sinceCsv)} desde el CSV
                              </div>
                            )}
                          </td>
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
                              <Lots holding={r.live} />
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

/**
 * What the transferred lots are worth today in the destination fund, versus what they would be worth had they
 * stayed in the origin (origin CSV value moved with the origin's NAV). The gap is the cost (or gain) of switching:
 * days out of the market plus the two funds' different paths since.
 */
function TransferCard({ t, name, onDismiss }: { t: Transfer; name: (h: Holding) => string; onDismiss: () => void }) {
  const invested = sum(t.lots.map((l) => l.invested));
  const actual = sum(t.lots.map((l) => l.value)) * navFactor(t.to);
  const wouldBe = sum(withLiveValues(t.from).lots.map((l) => l.value));
  const diff = actual - wouldBe;
  const dateTo = t.to.nav?.date, dateFrom = t.from.nav?.date;
  const comparable = !!dateTo && dateTo === dateFrom;
  return (
    <div className="transfer">
      <p>
        <strong>{name(t.from)}</strong> <span aria-hidden>→</span> <strong>{name(t.to)}</strong>
        <span className="muted small"> · {t.lots.length} aportaciones, {fmtEur(invested)} invertidos</span>
      </p>
      <dl className="transfer-kv">
        <div><dt>Hoy en el fondo nuevo</dt><dd>{fmtEur(actual)}</dd></div>
        <div><dt>Si no hubieras traspasado</dt><dd>{fmtEur(wouldBe)}</dd></div>
        <div><dt>{diff < 0 ? 'Pérdida estimada' : 'Ganancia estimada'}</dt>
          <dd className={diff >= 0 ? 'pos' : 'neg'}>{fmtSignedEur(diff)} <span className="small">({fmtSignedPct(wouldBe ? (diff / wouldBe) * 100 : 0)})</span></dd></div>
      </dl>
      <p className="muted small">
        {comparable ? `Ambos valorados con el valor liquidativo del ${fmtDate(dateTo)}. ` : 'Aproximado: no hay precios de ambos fondos al mismo día, así que la comparación mezcla fechas. '}
        Incluye los días sin invertir durante el traspaso y la distinta evolución de los dos fondos. El traspaso no tributa: se conservan fechas y coste fiscal.
        {' '}El fondo de origen ya no suma en los totales. <button className="link" onClick={onDismiss}>No es un traspaso</button>
      </p>
      <p className="transfer-note small">
        <strong>Es una estimación.</strong> Los CSV no traen participaciones ni el precio al que se valoró cada fondo, así que la cifra
        puede desviarse unos euros. El dato exacto está en las órdenes del traspaso de tu bróker: compara el importe del reembolso
        con lo que valdrían hoy esas participaciones en el fondo de origen.
      </p>
    </div>
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
  const shares = holding.lots.some((l) => l.shares != null);
  return (
    <div className="lots">
      <p className="muted small">
        {holding.lots.length} lotes (FIFO) ·{losing.length > 0 && ` ${losing.length} en pérdidas por ${fmtEur(-sum(losing.map((l) => l.result)))} ·`}
        {holding.dividends ? ` dividendos netos cobrados ${fmtEur(holding.dividends)} ·` : ''}
        {holding.realized ? ` resultado de ventas ${fmtSignedEur(holding.realized)} ·` : ''}
        {' '}importado de «{holding.fileName}»{holding.broker ? ` (${holding.broker})` : ''} el {fmtDate(holding.importedAt)}
      </p>
      <table>
        <thead>
          <tr><th>Fecha fiscal</th>{shares && <th className="num">Títulos</th>}<th className="num">Inversión</th><th className="num">Valor</th><th className="num">Resultado</th></tr>
        </thead>
        <tbody>
          {holding.lots.map((l, i) => (
            <tr key={i}>
              <td>{fmtDate(l.date)}</td>
              {shares && <td className="num">{fmtShares(l.shares ?? 0)}</td>}
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

function PrivacyText() {
  return (
    <>
      <span aria-hidden>🔒</span> Tus datos se procesan y guardan <strong>solo en este navegador</strong> y puedes borrarlos cuando quieras.
      Para actualizar valores e identificar fondos se consulta <strong>solo el ISIN</strong> de cada fondo (vía FT.com); nunca importes ni movimientos.{' '}
      <button className="link" onClick={() => dispatchEvent(new Event(OPEN_DATA_EVENT))}>Exportar o importar tus datos</button>
    </>
  );
}

