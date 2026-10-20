import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { byIsin, productLink } from '../data';
import { fmtDate, fmtEur, fmtPct, fmtSignedEur, fmtSignedPct } from '../format';
import { type Holding, loadHoldings, parseHoldingCsv, saveHoldings, sum, totals } from '../portfolio';
import { BarList, StepChart } from './Charts';

type GroupBy = 'fund' | 'region' | 'assetClass';

export function Portfolio() {
  const [holdings, setHoldings] = useState<Holding[]>(loadHoldings);
  const [errors, setErrors] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const [groupBy, setGroupBy] = useState<GroupBy>('fund');
  const [open, setOpen] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => saveHoldings(holdings), [holdings]);

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
        .map((h) => ({ h, product: byIsin.get(h.isin), name: byIsin.get(h.isin)?.name ?? h.name ?? h.isin, ...totals(h.lots) }))
        .sort((a, b) => b.value - a.value),
    [holdings],
  );
  const all = totals(holdings.flatMap((h) => h.lots));
  const known = rows.filter((r) => r.product?.totalCost != null);
  const weightedCost = known.length ? sum(known.map((r) => r.value * r.product!.totalCost!)) / sum(known.map((r) => r.value)) : null;

  const contributions = useMemo(() => {
    const byDate = new Map<string, number>();
    for (const l of holdings.flatMap((h) => h.lots)) byDate.set(l.date, (byDate.get(l.date) ?? 0) + l.invested);
    let acc = 0;
    return [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, v]) => ({ date, value: (acc += v) }));
  }, [holdings]);

  const allocation = useMemo(() => {
    const groups = new Map<string, { value: number; hint?: string }>();
    for (const r of rows) {
      const key =
        groupBy === 'fund' ? r.name
        : groupBy === 'region' ? r.product?.region ?? 'Sin clasificar'
        : r.product?.assetClass ?? 'Sin clasificar';
      const g = groups.get(key) ?? { value: 0 };
      g.value += r.value;
      groups.set(key, g);
    }
    return [...groups.entries()].map(([label, g]) => ({ label, ...g })).sort((a, b) => b.value - a.value);
  }, [rows, groupBy]);

  const rename = (isin: string, current?: string) => {
    const name = prompt('Nombre para este fondo (solo se guarda en tu navegador):', current ?? '')?.trim();
    if (name != null) setHoldings((cur) => cur.map((h) => (h.isin === isin ? { ...h, name: name || undefined } : h)));
  };

  const clear = () => {
    if (confirm('¿Borrar todos los datos de tu cartera de este navegador?')) {
      setHoldings([]);
      setErrors([]);
    }
  };

  return (
    <section>
      <div className="intro">
        <h1>Mi cartera</h1>
        <p className="muted">
          Importa los CSV de <em>plusvalías y minusvalías</em> de cada fondo (uno por fondo; el ISIN se toma del nombre del archivo).
        </p>
        <p className="privacy">
          <span aria-hidden>🔒</span> Tus datos se procesan y guardan <strong>solo en este navegador</strong> (localStorage).
          Nunca se envían a ningún servidor. Puedes borrarlos cuando quieras.
        </p>
      </div>

      <div
        className={`dropzone${dragging ? ' dragging' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); importFiles(e.dataTransfer.files); }}
      >
        <p><strong>Arrastra aquí tus CSV</strong> o</p>
        <button className="btn" onClick={() => input.current?.click()}>Seleccionar archivos</button>
        <input ref={input} type="file" accept=".csv,text/csv" multiple hidden
          onChange={(e) => { if (e.target.files) importFiles(e.target.files); e.target.value = ''; }} />
        <p className="muted small">Formato: <code>Fecha fiscal;Inversión;Valor de mercado;Resultado fiscal</code>. Reimportar un fondo sustituye sus datos.</p>
      </div>

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
          </div>

          <div className="panels">
            <div className="panel">
              <h2>Capital aportado acumulado</h2>
              <p className="muted small">Suma de la inversión de cada lote según su fecha fiscal.</p>
              <StepChart points={contributions} label="Capital aportado acumulado a lo largo del tiempo" />
            </div>
            <div className="panel">
              <div className="panel-head">
                <h2>Distribución</h2>
                <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)} aria-label="Agrupar por">
                  <option value="fund">Por fondo</option>
                  <option value="region">Por región / plazo</option>
                  <option value="assetClass">Por tipo de activo</option>
                </select>
              </div>
              <BarList items={allocation} />
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
                    const link = r.product && productLink(r.product);
                    const isOpen = open === r.h.isin;
                    return (
                      <Fragment key={r.h.isin}>
                        <tr>
                          <td data-label="Fondo" className="name-cell">
                            <div className="name">
                              {link ? <a href={link} target="_blank" rel="noreferrer">{r.name}</a> : r.name}
                            </div>
                            <div className="muted small mono">
                              {r.h.isin}
                              {r.product?.region && <span> · {r.product.region}</span>}
                              {!r.product && (
                                <span>
                                  {' '}· no está en el catálogo ·{' '}
                                  <button className="link" onClick={() => rename(r.h.isin, r.h.name)}>
                                    {r.h.name ? 'Renombrar' : 'Ponerle nombre'}
                                  </button>
                                </span>
                              )}
                            </div>
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
                            <button className="link" onClick={() => setHoldings((cur) => cur.filter((h) => h.isin !== r.h.isin))}>
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

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'pos' | 'neg' }) {
  return (
    <div className="kpi">
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
