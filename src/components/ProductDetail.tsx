import { useEffect, useMemo, useState } from 'react';
import { catalog, isNew, productLink, sameIndex } from '../data';
import { removeExternal } from '../external';
import { fmtDate, fmtPct, fmtRawPct } from '../format';
import type { Product } from '../types';
import { AddToSim } from './AddToSim';
import { AssetTag, CostBar } from './bits';
import { PriceChart } from './Charts';

export function ProductDetail({ p, onSelect, compared, onToggleCompare }: {
  p: Product;
  onSelect: (p: Product) => void;
  compared: boolean;
  onToggleCompare: (p: Product) => void;
}) {
  const link = productLink(p);
  const similar = sameIndex(p).slice(0, 6);
  const cheaperCount = similar.filter((s) => s.totalCost != null && p.totalCost != null && s.totalCost < p.totalCost).length;

  return (
    <div className="detail">
      <div className="detail-meta">
        {p.type !== 'plan' && <AssetTag p={p} />}
        <span className="muted">{p.type === 'plan' ? p.provider : p.region}</span>
        {isNew(p) && <span className="badge-new">Nuevo</span>}
        {p.external && <span className="badge-ext">No catalogado</span>}
      </div>
      <p className="muted small">
        <span className="mono">{p.isin ?? p.dgsCode}</span>
        {p.index && <> · Índice: {p.index}</>}
        {p.ticker && <> · Ticker: <span className="mono">{p.ticker}</span></>}
      </p>

      <div className="stat-grid">
        {p.type === 'accion' ? <Stat label="Comisión de gestión" value="No tiene" hint="solo pagas al comprar y vender" /> : <Stat label={p.external ? 'Gastos corrientes' : p.type === 'etf' ? 'TER' : p.type === 'alt' ? 'Coste anual' : 'Coste total'} value={fmtPct(p.totalCost, p.type === 'plan' ? 3 : 2)} strong>
          <CostBar p={p} />
        </Stat>}
        {p.external && p.type !== 'accion' && <Stat label="Categoría" value={p.region ?? '—'} />}
        {p.external && p.type !== 'accion' && <Stat label="Domicilio" value={p.external.domicile ?? '—'} />}
        {!p.external && p.type === 'fondo' && <Stat label="Rentabilidad 3 años" value={fmtPct(p.return3y)} hint="anualizada" />}
        {!p.external && p.type === 'fondo' && <Stat label="Rentabilidad 5 años" value={fmtPct(p.return5y)} hint="anualizada" />}
        {!p.external && p.type === 'etf' && <Stat label="Dividendos" value={p.distribution ?? '—'} />}
        {!p.external && p.type === 'etf' && <Stat label="Divisa" value={p.currency ?? '—'} />}
        {p.type === 'alt' && <Stat label="Estructura" value={p.structure ?? '—'} hint={p.backing} />}
        {p.type === 'alt' && <Stat label="Cotiza en" value={p.exchange ?? '—'} hint={[p.ticker, p.currency && `divisa ${p.currency}`].filter(Boolean).join(' · ')} />}
        {p.type === 'plan' && <Stat label="Renta variable / fija" value={p.equityPct != null ? `${p.equityPct} / ${100 - p.equityPct}` : '—'} />}
      </div>

      {p.isin && p.type !== 'plan' && <PriceHistory key={p.isin} isin={p.isin} type={p.type} />}

      {p.external && (
        <p className="muted small">
          No está en el catálogo: datos de {p.external.url ? <a href={p.external.url} target="_blank" rel="noreferrer">{p.external.source} ↗</a> : p.external.source}
          {p.external.source === 'OpenFIGI' ? ' (solo nombre; sin costes ni categoría)' : ''}, consultados el {fmtDate(p.external.checkedAt)}.
          {p.type === 'accion'
            ? ' Es una acción de una sola empresa: más arriesgada que un fondo indexado, que reparte el dinero entre cientos. Guardado solo en este navegador.'
            : ' Sin datos de rentabilidad ni plataformas. Guardado solo en este navegador.'}
        </p>
      )}

      {!p.external && (p.type === 'fondo' || p.type === 'plan') && (
        <section>
          <h3>Desglose de costes</h3>
          <dl className="kv">
            {p.type === 'fondo' ? (
              <>
                <dt>TER (gastos corrientes)</dt><dd>{fmtPct(p.ter)}</dd>
                <dt>Costes operativos</dt><dd>{fmtPct(p.operatingCosts)}</dd>
              </>
            ) : (
              <>
                <dt>Gestión + depósito</dt><dd>{fmtPct(p.managementFee)}</dd>
                <dt>Fondos subyacentes</dt><dd>{fmtPct(p.fundsFee, 3)}</dd>
                <dt>Otros gastos</dt><dd>{fmtPct(p.otherFees, 3)}</dd>
              </>
            )}
            <dt><strong>Total</strong></dt><dd><strong>{fmtPct(p.totalCost, p.type === 'plan' ? 3 : 2)}</strong></dd>
          </dl>
        </section>
      )}

      {!p.external && p.type === 'fondo' && (
        <section>
          <h3>Dónde contratarlo</h3>
          <ul className="platform-list">
            {catalog.platforms.map((pl) => {
              const has = p.platforms?.includes(pl);
              return (
                <li key={pl} className={has ? '' : 'off'}>
                  <span aria-hidden>{has ? '✓' : '—'}</span>
                  <span>{pl}<span className="sr-only">{has ? ': disponible' : ': no disponible'}</span></span>
                  {has && catalog.platformNotes[pl] && <span className="muted small">{catalog.platformNotes[pl]!.split('\n').join(' · ')}</span>}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {p.securitiesLending && (
        <section>
          <h3>Préstamo de valores</h3>
          <dl className="kv">
            <dt>Cartera prestada</dt><dd>{fmtRawPct(p.securitiesLending.lent)}</dd>
            <dt>Ingresos para el fondo</dt><dd>{fmtRawPct(p.securitiesLending.income)}</dd>
            <dt>Colateral AAA</dt><dd>{fmtRawPct(p.securitiesLending.collateral)}</dd>
          </dl>
        </section>
      )}

      {p.note && <p className="small">{p.note}</p>}
      {p.type === 'alt' && (
        <p className="muted small">
          {p.structure === 'ETF UCITS' ? 'Fondo cotizado UCITS: patrimonio separado del emisor.'
            : `Un ${p.structure} es un título de deuda del emisor${p.backing === 'Física' ? ' respaldado por el activo físico en custodia' : ' que replica el precio mediante contratos (swap)'}; no es un fondo UCITS.`}
          {' '}Se compra en bolsa; consulta en tu bróker si está disponible.
        </p>
      )}

      {p.type === 'etf' && p.degiroExchange && (
        <p className="muted small">Comisión de 1 € en Degiro cotizando en {p.degiroExchange}.</p>
      )}

      {similar.length > 0 && (
        <section>
          <h3>{p.index ? 'Mismo índice' : 'Misma categoría'}</h3>
          {cheaperCount > 0 && <p className="small muted">{cheaperCount} {cheaperCount === 1 ? 'alternativa es' : 'alternativas son'} más {cheaperCount === 1 ? 'barata' : 'baratas'}.</p>}
          <ul className="similar">
            {similar.map((s) => (
              <li key={s.id}>
                <button className="similar-item" onClick={() => onSelect(s)}>
                  <span>{s.name}</span>
                  <span className={`num ${s.totalCost != null && p.totalCost != null && s.totalCost < p.totalCost ? 'pos' : ''}`}>
                    {fmtPct(s.totalCost, s.type === 'plan' ? 3 : 2)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="detail-actions">
        <AddToSim p={p} />
        <button className="btn" aria-pressed={compared} onClick={() => onToggleCompare(p)}>
          {compared ? '✓ En el comparador' : '+ Añadir al comparador'}
        </button>
        {link && <a className="btn btn-primary" href={link} target="_blank" rel="noreferrer">Ver en {p.type === 'etf' || p.type === 'alt' ? 'justETF' : p.type === 'accion' ? 'FT.com' : 'Morningstar'} ↗</a>}
      </div>
      {p.curated && p.type !== 'alt' && (
        <p className="muted small">Añadido por Invertario (no está en la hoja comunitaria){p.exchange && `; cotiza en ${p.exchange}`}.</p>
      )}
      {p.addedAt && <p className="muted small">En Invertario desde el {fmtDate(p.addedAt)}.</p>}
      {p.external && (
        <p className="small"><button className="link" onClick={() => removeExternal(p.id)}>Olvidar este producto</button> <span className="muted">(se quitará de este navegador)</span></p>
      )}
    </div>
  );
}

function Stat({ label, value, hint, strong, children }: { label: string; value: string; hint?: string; strong?: boolean; children?: React.ReactNode }) {
  return (
    <div className="stat">
      <div className="muted small">{label}</div>
      <div className={`stat-value${strong ? ' strong' : ''}`}>{value}</div>
      {hint && <div className="muted small">{hint}</div>}
      {children}
    </div>
  );
}

interface History { currency: string; source: string; points: [string, number][] }
// Per page load: reopening a product doesn't refetch (the API is also cached at the edge for 12 h).
const historyCache = new Map<string, Promise<History | null>>();
function fetchHistory(isin: string): Promise<History | null> {
  let h = historyCache.get(isin);
  if (!h) {
    h = fetch(`/api/fund?isin=${encodeURIComponent(isin)}&history=5y`)
      .then(async (r) => (r.ok ? ((await r.json()) as History) : r.status === 404 ? null : Promise.reject(new Error(`HTTP ${r.status}`))));
    h.catch(() => historyCache.delete(isin));
    historyCache.set(isin, h);
  }
  return h;
}

const RANGES = [{ id: 1, label: '1 año' }, { id: 3, label: '3 años' }, { id: 5, label: '5 años' }] as const;

/** Weekly price over the last 1/3/5 years (FT.com). Sends only the ISIN. */
function PriceHistory({ isin, type }: { isin: string; type: Product['type'] }) {
  const [state, setState] = useState<{ status: 'loading' | 'ok' | 'none' | 'error'; data?: History }>({ status: 'loading' });
  const [years, setYears] = useState<1 | 3 | 5>(5);
  useEffect(() => {
    let live = true;
    fetchHistory(isin).then(
      (data) => live && setState(data && data.points.length > 1 ? { status: 'ok', data } : { status: 'none' }),
      () => live && setState({ status: 'error' }),
    );
    return () => { live = false; };
  }, [isin]);

  const points = useMemo(() => {
    if (!state.data) return [];
    const from = Date.now() - years * 365.25 * 86_400_000;
    return state.data.points.map(([d, price]) => ({ t: new Date(d).getTime(), price })).filter((p) => p.t >= from);
  }, [state.data, years]);
  const spanYears = points.length > 1 ? (points.at(-1)!.t - points[0].t) / (365.25 * 86_400_000) : 0;
  const change = points.length > 1 ? (points.at(-1)!.price / points[0].price - 1) * 100 : 0;
  const annual = spanYears >= 1.5 ? (Math.pow(points.at(-1)!.price / points[0].price, 1 / spanYears) - 1) * 100 : null;
  const maxYears = state.data ? Math.ceil((Date.now() - new Date(state.data.points[0][0]).getTime()) / (365.25 * 86_400_000) - 0.05) : 5;
  const unit = type === 'fondo' ? 'del valor liquidativo' : 'de la cotización';
  const ranges = RANGES.filter((r) => r.id === 1 || r.id <= maxYears + 0.5);

  if (state.status === 'none') return null;
  return (
    <section className="price-history">
      <div className="price-history-head">
        <h3>Evolución {unit}</h3>
        {state.status === 'ok' && ranges.length > 1 && (
          <div className="segmented small-seg" role="radiogroup" aria-label="Periodo">
            {ranges.map((r) => (
              <button key={r.id} role="radio" aria-checked={years === r.id} aria-selected={years === r.id} onClick={() => setYears(r.id)}>{r.label}</button>
            ))}
          </div>
        )}
      </div>
      {state.status === 'loading' && <p className="muted small">Cargando histórico…</p>}
      {state.status === 'error' && <p className="muted small">No se ha podido cargar el histórico ahora mismo.</p>}
      {state.status === 'ok' && points.length > 1 && (
        <>
          <p className="small">
            <strong className={change >= 0 ? 'pos' : 'neg'}>{change >= 0 ? '▲ +' : '▼ '}{change.toLocaleString('es-ES', { maximumFractionDigits: 1 })} %</strong>
            {' '}desde {new Intl.DateTimeFormat('es-ES', { month: 'short', year: 'numeric' }).format(points[0].t)}
            {annual != null && <span className="muted"> · {annual.toLocaleString('es-ES', { maximumFractionDigits: 1 })} % anual</span>}
          </p>
          <PriceChart points={points} currency={state.data!.currency} label={`Evolución ${unit} en ${years === 1 ? 'el último año' : `los últimos ${years} años`}`} />
          <p className="muted small">
            Precio semanal en {state.data!.currency} de <a href={state.data!.source} target="_blank" rel="noreferrer">FT.com ↗</a>
            {type === 'fondo' || type === 'etf' ? '. Ya descuenta los gastos del fondo; rentabilidades pasadas no garantizan las futuras.' : '. Rentabilidades pasadas no garantizan las futuras.'}
            {state.data!.currency !== 'EUR' && ' En otra divisa: no incluye el efecto del tipo de cambio para un inversor en euros.'}
          </p>
        </>
      )}
    </section>
  );
}
