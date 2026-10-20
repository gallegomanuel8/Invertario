import { useEffect, useMemo, useState } from 'react';
import { catalog, cheapestByCategory, isNew, NEW_DAYS } from '../data';
import { fmtDate, fmtPct } from '../format';
import type { Product, ProductType } from '../types';
import { AssetTag, CostBar } from './bits';
import { Compare } from './Compare';
import { ProductDetail } from './ProductDetail';
import { Sheet } from './Sheet';

const MAX_COMPARE = 3;

const TYPES: { id: ProductType; label: string }[] = [
  { id: 'fondo', label: 'Fondos indexados' },
  { id: 'etf', label: 'ETFs' },
  { id: 'plan', label: 'Planes de pensiones' },
];

type SortKey = 'name' | 'totalCost' | 'return3y' | 'return5y' | 'addedAt';
type Dir = 1 | -1;

interface Filters {
  type: ProductType;
  query: string;
  assetClass: string;
  region: string;
  platforms: string[];
  onlyNew: boolean;
  sort: { key: SortKey; dir: Dir };
  /** Product whose detail sheet is open, and products in the comparator (ids). */
  detail: string;
  compare: string[];
  compareOpen: boolean;
}

const DEFAULTS: Filters = {
  type: 'fondo', query: '', assetClass: '', region: '', platforms: [], onlyNew: false,
  sort: { key: 'totalCost', dir: 1 },
  detail: '', compare: [], compareOpen: false,
};
const byId = new Map(catalog.items.map((p) => [p.id, p]));
const SORT_KEYS: SortKey[] = ['name', 'totalCost', 'return3y', 'return5y', 'addedAt'];

// Filters live in the hash (#/?t=etf&q=…) so a search can be bookmarked or shared.
function readFilters(): Filters {
  const params = new URLSearchParams(location.hash.split('?')[1] ?? '');
  const type = TYPES.some((t) => t.id === params.get('t')) ? (params.get('t') as ProductType) : DEFAULTS.type;
  const key = SORT_KEYS.includes(params.get('s') as SortKey) ? (params.get('s') as SortKey) : DEFAULTS.sort.key;
  return {
    type,
    query: params.get('q') ?? '',
    assetClass: params.get('c') ?? '',
    region: params.get('r') ?? '',
    platforms: params.get('p')?.split(',').filter((p) => catalog.platforms.includes(p)) ?? [],
    onlyNew: params.get('n') === '1',
    sort: { key, dir: params.get('d') === '-1' ? -1 : params.has('s') ? 1 : DEFAULTS.sort.dir },
    detail: byId.has(params.get('f') ?? '') ? params.get('f')! : '',
    compare: params.get('cmp')?.split(',').filter((id) => byId.has(id)).slice(0, 3) ?? [],
    compareOpen: params.get('vs') === '1',
  };
}

function writeFilters(f: Filters) {
  const params = new URLSearchParams();
  if (f.type !== DEFAULTS.type) params.set('t', f.type);
  if (f.query) params.set('q', f.query);
  if (f.assetClass) params.set('c', f.assetClass);
  if (f.region) params.set('r', f.region);
  if (f.platforms.length) params.set('p', f.platforms.join(','));
  if (f.onlyNew) params.set('n', '1');
  if (f.sort.key !== DEFAULTS.sort.key || f.sort.dir !== DEFAULTS.sort.dir) {
    params.set('s', f.sort.key);
    if (f.sort.dir === -1) params.set('d', '-1');
  }
  if (f.detail) params.set('f', f.detail);
  if (f.compare.length) params.set('cmp', f.compare.join(','));
  if (f.compareOpen && f.compare.length >= 2) params.set('vs', '1');
  const qs = params.toString();
  history.replaceState(null, '', qs ? `#/?${qs}` : '#/');
}

const unique = (xs: (string | null | undefined)[]) => [...new Set(xs.filter(Boolean) as string[])];
const defaultDir = (key: SortKey): Dir => (key === 'name' || key === 'totalCost' ? 1 : -1);

const SORT_LABELS: Record<ProductType, [SortKey, string][]> = {
  fondo: [['totalCost', 'Coste total'], ['return3y', 'Rentabilidad 3 años'], ['return5y', 'Rentabilidad 5 años'], ['name', 'Nombre'], ['addedAt', 'Recién añadidos']],
  etf: [['totalCost', 'TER'], ['name', 'Nombre'], ['addedAt', 'Recién añadidos']],
  plan: [['totalCost', 'Coste total'], ['name', 'Nombre'], ['addedAt', 'Recién añadidos']],
};

export function Catalog() {
  const [f, setF] = useState<Filters>(readFilters);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const detail = f.detail ? byId.get(f.detail)! : null;
  const setDetail = (p: Product | null) => update({ detail: p?.id ?? '' });
  const compare = f.compare.map((id) => byId.get(id)!);
  const compareOpen = f.compareOpen && compare.length >= 2;
  const setCompareOpen = (open: boolean) => update({ compareOpen: open });
  const toggleCompare = (p: Product) =>
    setF((cur) => ({
      ...cur,
      compare: cur.compare.includes(p.id) ? cur.compare.filter((id) => id !== p.id)
        : cur.compare.length < MAX_COMPARE ? [...cur.compare, p.id] : cur.compare,
    }));
  const inCompare = (p: Product) => compare.some((c) => c.id === p.id);
  const update = (patch: Partial<Filters>) => setF((cur) => ({ ...cur, ...patch }));

  useEffect(() => writeFilters(f), [f]);

  const ofType = useMemo(() => catalog.items.filter((p) => p.type === f.type), [f.type]);
  const classes = unique(ofType.map((p) => p.assetClass));
  const regions = unique(ofType.filter((p) => !f.assetClass || p.assetClass === f.assetClass).map((p) => p.region));
  const newCount = ofType.filter((p) => isNew(p)).length;
  const activeFilters = [f.query, f.assetClass, f.region, f.onlyNew].filter(Boolean).length + f.platforms.length;

  const rows = useMemo(() => {
    const q = f.query.trim().toLowerCase();
    const filtered = ofType.filter(
      (p) =>
        (!q || [p.name, p.isin, p.index, p.ticker].some((v) => v?.toLowerCase().includes(q))) &&
        (!f.assetClass || p.assetClass === f.assetClass) &&
        (!f.region || p.region === f.region) &&
        f.platforms.every((pl) => p.platforms?.includes(pl)) &&
        (!f.onlyNew || isNew(p)),
    );
    const { key, dir } = f.sort;
    const val = (p: Product) => (key === 'name' ? p.name : (p[key] ?? null));
    return filtered.sort((a, b) => {
      const va = val(a), vb = val(b);
      if (va == null) return vb == null ? 0 : 1; // nulls always last
      if (vb == null) return -1;
      return (typeof va === 'string' ? va.localeCompare(vb as string) : va - (vb as number)) * dir;
    });
  }, [ofType, f]);

  const clearFilters = () => update({ query: '', assetClass: '', region: '', platforms: [], onlyNew: false });
  const switchType = (type: ProductType) =>
    update({ type, assetClass: '', region: '', platforms: [], onlyNew: false, sort: DEFAULTS.sort, detail: '' });
  const togglePlatform = (pl: string) =>
    update({ platforms: f.platforms.includes(pl) ? f.platforms.filter((x) => x !== pl) : [...f.platforms, pl] });
  const sortBy = (key: SortKey) =>
    update({ sort: { key, dir: f.sort.key === key ? (f.sort.dir === 1 ? -1 : 1) : defaultDir(key) } });
  const th = (key: SortKey, label: string, className = '') => (
    <th className={className} aria-sort={f.sort.key === key ? (f.sort.dir === 1 ? 'ascending' : 'descending') : undefined}>
      <button className="sort" onClick={() => sortBy(key)}>
        {label}
        <span aria-hidden>{f.sort.key === key ? (f.sort.dir === 1 ? ' ↑' : ' ↓') : ''}</span>
      </button>
    </th>
  );
  const platformNotes = catalog.platforms.filter((pl) => catalog.platformNotes[pl]);
  const picks = useMemo(() => cheapestByCategory(f.type), [f.type]);

  return (
    <section>
      <Hero />

      <div className="segmented" role="tablist">
        {TYPES.map((t) => (
          <button key={t.id} role="tab" aria-selected={f.type === t.id} onClick={() => switchType(t.id)}>
            {t.label}
            <span className="count">{catalog.items.filter((p) => p.type === t.id).length}</span>
          </button>
        ))}
      </div>

      <section className="picks" aria-labelledby="picks-title">
        <h2 id="picks-title">Los más baratos de cada categoría</h2>
        <div className="picks-row">
          {picks.map((p) => (
            <button key={p.id} className="pick" onClick={() => setDetail(p)}>
              <span className="pick-cat"><AssetTag p={p} /> {f.type === 'plan' ? p.assetClass : p.region ?? p.assetClass}</span>
              <span className="pick-name">{p.name}</span>
              <span className="pick-cost">{fmtPct(p.totalCost, f.type === 'plan' ? 3 : 2)}<span className="muted small"> {f.type === 'etf' ? 'TER' : 'coste total'}</span></span>
            </button>
          ))}
        </div>
      </section>

      <div className="search-row">
        <input
          type="search"
          placeholder={f.type === 'etf' ? 'Buscar por nombre, ISIN o ticker…' : 'Buscar por nombre, ISIN o índice…'}
          value={f.query}
          onChange={(e) => update({ query: e.target.value })}
          aria-label="Buscar"
        />
        <button className="btn filters-toggle" aria-expanded={filtersOpen} aria-controls="filters" onClick={() => setFiltersOpen((o) => !o)}>
          Filtros{activeFilters - (f.query ? 1 : 0) > 0 && ` (${activeFilters - (f.query ? 1 : 0)})`}
        </button>
      </div>

      <div id="filters" className={`filters-panel${filtersOpen ? ' open' : ''}`}>
        <div className="filters">
          <select value={f.assetClass} onChange={(e) => update({ assetClass: e.target.value, region: '' })} aria-label="Tipo de activo">
            <option value="">Todos los activos</option>
            {classes.map((c) => <option key={c}>{c}</option>)}
          </select>
          <select value={f.region} onChange={(e) => update({ region: e.target.value })} aria-label={f.type === 'plan' ? 'Gestora' : 'Región o plazo'}>
            <option value="">{f.type === 'plan' ? 'Todas las gestoras' : 'Todas las regiones / plazos'}</option>
            {regions.map((r) => <option key={r}>{r}</option>)}
          </select>
          <select
            className="mobile-only"
            value={`${f.sort.key}:${f.sort.dir}`}
            onChange={(e) => { const [key, dir] = e.target.value.split(':'); update({ sort: { key: key as SortKey, dir: Number(dir) as Dir } }); }}
            aria-label="Ordenar por"
          >
            {SORT_LABELS[f.type].flatMap(([key, label]) => [
              <option key={`${key}:${defaultDir(key)}`} value={`${key}:${defaultDir(key)}`}>Ordenar: {label}</option>,
            ])}
            {!SORT_LABELS[f.type].some(([key]) => key === f.sort.key && defaultDir(key) === f.sort.dir) && (
              <option value={`${f.sort.key}:${f.sort.dir}`}>Ordenar: personalizado</option>
            )}
          </select>
          <label className={`check${newCount ? '' : ' disabled'}`} title={newCount ? undefined : `No hay productos añadidos en los últimos ${NEW_DAYS} días`}>
            <input type="checkbox" checked={f.onlyNew} disabled={!newCount && !f.onlyNew} onChange={(e) => update({ onlyNew: e.target.checked })} />
            Solo nuevos ({newCount})
          </label>
        </div>

        {f.type === 'fondo' && (
          <>
            <div className="chips" aria-label="Disponible en">
              <span className="muted small">Disponible en:</span>
              {catalog.platforms.map((pl) => (
                <button key={pl} className="chip" aria-pressed={f.platforms.includes(pl)} onClick={() => togglePlatform(pl)}>
                  {pl}
                </button>
              ))}
            </div>
            {platformNotes.length > 0 && (
              <details className="platform-notes">
                <summary className="small">Condiciones de las plataformas</summary>
                <dl>
                  {platformNotes.map((pl) => (
                    <div key={pl}>
                      <dt>{pl}</dt>
                      <dd>{catalog.platformNotes[pl]!.split('\n').join(' · ')}</dd>
                    </div>
                  ))}
                </dl>
              </details>
            )}
          </>
        )}
      </div>

      <p className="muted small results">
        {rows.length} resultado{rows.length === 1 ? '' : 's'}
        {activeFilters > 0 && <> · <button className="link" onClick={clearFilters}>Quitar filtros</button></>}
        {f.type === 'fondo' && catalog.returnsAsOf && ` · Rentabilidades anualizadas a ${fmtDate(catalog.returnsAsOf)}`}
        {` · «Nuevo» = añadido hace menos de ${NEW_DAYS} días`}
      </p>

      <div className="table-wrap">
        <table className="catalog">
          <thead>
            <tr>
              {th('name', 'Nombre')}
              <th>{f.type === 'plan' ? 'Gestora' : 'Categoría'}</th>
              {th('totalCost', f.type === 'etf' ? 'TER' : 'Coste total', 'num')}
              {f.type === 'fondo' && th('return3y', 'Rent. 3 a', 'num')}
              {f.type === 'fondo' && th('return5y', 'Rent. 5 a', 'num')}
              {f.type === 'fondo' && <th>Plataformas</th>}
              {f.type === 'etf' && <th>Ticker</th>}
              {f.type === 'etf' && <th>Dividendos</th>}
              {f.type === 'plan' && <th className="num">RV / RF</th>}
              {f.type === 'plan' && <th>Código DGS</th>}
              <th className="compare-col"><span className="sr-only">Comparar</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <Row key={p.id} p={p} onOpen={setDetail} compared={inCompare(p)}
                compareFull={compare.length >= MAX_COMPARE} onToggleCompare={toggleCompare} />
            ))}
          </tbody>
        </table>
        {!rows.length && (
          <div className="empty">
            <p>Ningún producto coincide con los filtros.</p>
            {activeFilters > 0 && <button className="btn" onClick={clearFilters}>Quitar filtros</button>}
          </div>
        )}
      </div>

      {compare.length > 0 && (
        <div className="compare-bar" role="region" aria-label="Comparador">
          <span className="compare-bar-items">
            {compare.map((p) => (
              <span key={p.id} className="pill">
                {p.name.length > 28 ? p.name.slice(0, 27) + '…' : p.name}
                <button className="pill-x" aria-label={`Quitar ${p.name} del comparador`} onClick={() => toggleCompare(p)}>✕</button>
              </span>
            ))}
          </span>
          <button className="btn btn-primary" disabled={compare.length < 2} onClick={() => setCompareOpen(true)}>
            Comparar ({compare.length})
          </button>
        </div>
      )}

      <Sheet open={detail != null} onClose={() => setDetail(null)} title={detail?.name}>
        {detail && <ProductDetail p={detail} onSelect={setDetail} compared={inCompare(detail)} onToggleCompare={toggleCompare} />}
      </Sheet>
      <Sheet open={compareOpen} onClose={() => setCompareOpen(false)} title="Comparador" wide>
        <Compare items={compare} onRemove={(p) => { toggleCompare(p); if (compare.length <= 2) setCompareOpen(false); }}
          onOpen={(p) => update({ compareOpen: false, detail: p.id })} />
      </Sheet>
    </section>
  );
}

function Hero() {
  const count = (t: ProductType) => catalog.items.filter((p) => p.type === t).length;
  const newOnes = catalog.items.filter((p) => isNew(p)).length;
  const cheapestWorld = catalog.items
    .filter((p) => p.type === 'fondo' && p.region === 'Global' && p.assetClass === 'Renta Variable' && p.totalCost != null)
    .sort((a, b) => a.totalCost! - b.totalCost!)[0];
  return (
    <div className="hero">
      <div className="hero-text">
        <p className="eyebrow">Inversión indexada en España</p>
        <h1>Encuentra el fondo indexado más barato y sigue tu cartera</h1>
        <p className="muted">
          Fondos, ETFs y planes de pensiones de bajo coste y en qué plataformas puedes contratarlos. Datos de la{' '}
          <a href={catalog.source} target="_blank" rel="noreferrer">hoja comunitaria</a>, actualizada el {fmtDate(catalog.sourceUpdatedAt)}.
        </p>
      </div>
      <dl className="hero-stats">
        <div><dt>Productos</dt><dd>{catalog.items.length}</dd><span className="muted small">{count('fondo')} fondos · {count('etf')} ETFs · {count('plan')} planes</span></div>
        {cheapestWorld && (
          <div><dt>Fondo global más barato</dt><dd>{fmtPct(cheapestWorld.totalCost)}</dd><span className="muted small">{cheapestWorld.name}</span></div>
        )}
        <div><dt>Nuevos este mes</dt><dd>{newOnes}</dd><span className="muted small">Añadidos en los últimos {NEW_DAYS} días</span></div>
      </dl>
    </div>
  );
}

function Row({ p, onOpen, compared, compareFull, onToggleCompare }: {
  p: Product;
  onOpen: (p: Product) => void;
  compared: boolean;
  compareFull: boolean;
  onToggleCompare: (p: Product) => void;
}) {
  const costDetail =
    p.type === 'fondo'
      ? `TER ${fmtPct(p.ter)} + costes operativos ${fmtPct(p.operatingCosts)}`
      : p.type === 'plan'
        ? `Gestión+depósito ${fmtPct(p.managementFee)} · fondos ${fmtPct(p.fundsFee, 3)} · otros ${fmtPct(p.otherFees, 3)}`
        : undefined;
  return (
    <tr>
      <td data-label="Nombre" className="name-cell">
        <div className="name">
          <button className="name-btn" onClick={() => onOpen(p)}>{p.name}</button>
          {isNew(p) && <span className="badge-new" title={`Añadido el ${fmtDate(p.addedAt)}`}>Nuevo</span>}
        </div>
        <div className="muted small">
          <span className="mono">{p.isin ?? p.dgsCode ?? ''}</span>
          {p.index && <span> · {p.index}</span>}
        </div>
      </td>
      <td data-label={p.type === 'plan' ? 'Gestora' : 'Categoría'} className="cat-cell">
        {p.type === 'plan' ? p.provider : (
          <>
            <AssetTag p={p} />{' '}
            {p.region ?? ''}
          </>
        )}
      </td>
      <td data-label={p.type === 'etf' ? 'TER' : 'Coste total'} className="num" title={costDetail}>
        <strong>{fmtPct(p.totalCost, p.type === 'plan' ? 3 : 2)}</strong>
        <CostBar p={p} />
      </td>
      {p.type === 'fondo' && <td data-label="Rent. 3 años" className={`num${p.return3y == null ? ' empty-cell' : ''}`}>{fmtPct(p.return3y)}</td>}
      {p.type === 'fondo' && <td data-label="Rent. 5 años" className={`num${p.return5y == null ? ' empty-cell' : ''}`}>{fmtPct(p.return5y)}</td>}
      {p.type === 'fondo' && (
        <td data-label="Plataformas" className="platforms-cell">
          <div className="platforms">
            {p.platforms?.length ? p.platforms.map((pl) => <span key={pl} className="pill">{pl}</span>) : <span className="muted">—</span>}
          </div>
        </td>
      )}
      {p.type === 'etf' && <td data-label="Ticker" className="mono">{p.ticker}</td>}
      {p.type === 'etf' && <td data-label="Dividendos">{p.distribution ?? '—'}{p.currency && p.currency !== 'EUR' ? ` · ${p.currency}` : ''}</td>}
      {p.type === 'plan' && <td data-label="RV / RF" className="num">{p.equityPct != null ? `${p.equityPct} / ${100 - p.equityPct}` : '—'}</td>}
      {p.type === 'plan' && <td data-label="Código DGS" className="mono">{p.dgsCode ?? '—'}</td>}
      <td className="compare-cell">
        <button
          className="compare-toggle"
          aria-pressed={compared}
          disabled={!compared && compareFull}
          onClick={() => onToggleCompare(p)}
          title={!compared && compareFull ? 'Máximo 3 productos' : undefined}
        >
          {compared ? '✓ Comparando' : '+ Comparar'}
        </button>
      </td>
    </tr>
  );
}
