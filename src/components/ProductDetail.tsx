import { catalog, isNew, productLink, sameIndex } from '../data';
import { fmtDate, fmtPct, fmtRawPct } from '../format';
import type { Product } from '../types';
import { AddToSim } from './AddToSim';
import { AssetTag, CostBar } from './bits';

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
      </div>
      <p className="muted small">
        <span className="mono">{p.isin ?? p.dgsCode}</span>
        {p.index && <> · Índice: {p.index}</>}
        {p.ticker && <> · Ticker: <span className="mono">{p.ticker}</span></>}
      </p>

      <div className="stat-grid">
        <Stat label={p.type === 'etf' ? 'TER' : 'Coste total'} value={fmtPct(p.totalCost, p.type === 'plan' ? 3 : 2)} strong>
          <CostBar p={p} />
        </Stat>
        {p.type === 'fondo' && <Stat label="Rentabilidad 3 años" value={fmtPct(p.return3y)} hint="anualizada" />}
        {p.type === 'fondo' && <Stat label="Rentabilidad 5 años" value={fmtPct(p.return5y)} hint="anualizada" />}
        {p.type === 'etf' && <Stat label="Dividendos" value={p.distribution ?? '—'} />}
        {p.type === 'etf' && <Stat label="Divisa" value={p.currency ?? '—'} />}
        {p.type === 'plan' && <Stat label="Renta variable / fija" value={p.equityPct != null ? `${p.equityPct} / ${100 - p.equityPct}` : '—'} />}
      </div>

      {(p.type === 'fondo' || p.type === 'plan') && (
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

      {p.type === 'fondo' && (
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
        {link && <a className="btn btn-primary" href={link} target="_blank" rel="noreferrer">Ver en {p.type === 'etf' ? 'justETF' : 'Morningstar'} ↗</a>}
      </div>
      {p.addedAt && <p className="muted small">En Invertario desde el {fmtDate(p.addedAt)}.</p>}
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
