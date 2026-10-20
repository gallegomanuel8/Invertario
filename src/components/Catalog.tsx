import { useMemo, useState } from 'react';
import { catalog, isNew, NEW_DAYS, productLink } from '../data';
import { fmtDate, fmtPct } from '../format';
import type { Product, ProductType } from '../types';

const TYPES: { id: ProductType; label: string }[] = [
  { id: 'fondo', label: 'Fondos indexados' },
  { id: 'etf', label: 'ETFs' },
  { id: 'plan', label: 'Planes de pensiones' },
];

type SortKey = 'name' | 'totalCost' | 'return3y' | 'return5y' | 'addedAt';

const unique = (xs: (string | null | undefined)[]) => [...new Set(xs.filter(Boolean) as string[])];

export function Catalog() {
  const [type, setType] = useState<ProductType>('fondo');
  const [query, setQuery] = useState('');
  const [assetClass, setAssetClass] = useState('');
  const [region, setRegion] = useState('');
  const [platforms, setPlatforms] = useState<string[]>([]);
  const [onlyNew, setOnlyNew] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'totalCost', dir: 1 });

  const ofType = useMemo(() => catalog.items.filter((p) => p.type === type), [type]);
  const classes = unique(ofType.map((p) => p.assetClass));
  const regions = unique(ofType.filter((p) => !assetClass || p.assetClass === assetClass).map((p) => p.region));
  const newCount = catalog.items.filter((p) => isNew(p)).length;

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = ofType.filter(
      (p) =>
        (!q || [p.name, p.isin, p.index, p.ticker].some((v) => v?.toLowerCase().includes(q))) &&
        (!assetClass || p.assetClass === assetClass) &&
        (!region || p.region === region) &&
        platforms.every((pl) => p.platforms?.includes(pl)) &&
        (!onlyNew || isNew(p)),
    );
    const val = (p: Product) => (sort.key === 'name' ? p.name : (p[sort.key] ?? null));
    return filtered.sort((a, b) => {
      const va = val(a), vb = val(b);
      if (va == null) return vb == null ? 0 : 1; // nulls always last
      if (vb == null) return -1;
      return (typeof va === 'string' ? va.localeCompare(vb as string) : va - (vb as number)) * sort.dir;
    });
  }, [ofType, query, assetClass, region, platforms, onlyNew, sort]);

  const switchType = (t: ProductType) => {
    setType(t);
    setAssetClass('');
    setRegion('');
    setPlatforms([]);
  };
  const togglePlatform = (pl: string) =>
    setPlatforms((cur) => (cur.includes(pl) ? cur.filter((x) => x !== pl) : [...cur, pl]));
  const sortBy = (key: SortKey) =>
    setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : key === 'name' || key === 'totalCost' ? 1 : -1 }));
  const th = (key: SortKey, label: string, className = '') => (
    <th className={className} aria-sort={sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}>
      <button className="sort" onClick={() => sortBy(key)}>
        {label}
        <span aria-hidden>{sort.key === key ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''}</span>
      </button>
    </th>
  );

  return (
    <section>
      <div className="intro">
        <h1>Catálogo de productos indexados</h1>
        <p className="muted">
          Fondos, ETFs y planes de pensiones de bajo coste disponibles en plataformas españolas. Datos de la{' '}
          <a href={catalog.source} target="_blank" rel="noreferrer">hoja comunitaria</a> (actualizada el{' '}
          {fmtDate(catalog.sourceUpdatedAt)}), sincronizados a diario. Última comprobación: {fmtDate(catalog.syncedAt)}.
        </p>
      </div>

      <div className="segmented" role="tablist">
        {TYPES.map((t) => (
          <button key={t.id} role="tab" aria-selected={type === t.id} onClick={() => switchType(t.id)}>
            {t.label}
            <span className="count">{catalog.items.filter((p) => p.type === t.id).length}</span>
          </button>
        ))}
      </div>

      <div className="filters">
        <input
          type="search"
          placeholder={type === 'etf' ? 'Buscar por nombre, ISIN o ticker…' : 'Buscar por nombre, ISIN o índice…'}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Buscar"
        />
        <select value={assetClass} onChange={(e) => { setAssetClass(e.target.value); setRegion(''); }} aria-label="Tipo de activo">
          <option value="">Todos los activos</option>
          {classes.map((c) => <option key={c}>{c}</option>)}
        </select>
        <select value={region} onChange={(e) => setRegion(e.target.value)} aria-label={type === 'plan' ? 'Gestora' : 'Región o plazo'}>
          <option value="">{type === 'plan' ? 'Todas las gestoras' : 'Todas las regiones / plazos'}</option>
          {regions.map((r) => <option key={r}>{r}</option>)}
        </select>
        <label className="check">
          <input type="checkbox" checked={onlyNew} onChange={(e) => setOnlyNew(e.target.checked)} />
          Solo nuevos ({newCount})
        </label>
      </div>

      {type === 'fondo' && (
        <div className="chips" aria-label="Disponible en">
          <span className="muted small">Disponible en:</span>
          {catalog.platforms.map((pl) => (
            <button
              key={pl}
              className="chip"
              aria-pressed={platforms.includes(pl)}
              onClick={() => togglePlatform(pl)}
              title={catalog.platformNotes[pl]?.replace(/\n/g, ' · ') ?? undefined}
            >
              {pl}
            </button>
          ))}
        </div>
      )}

      <p className="muted small results">
        {rows.length} resultado{rows.length === 1 ? '' : 's'}
        {type === 'fondo' && catalog.returnsAsOf && ` · Rentabilidades anualizadas a ${fmtDate(catalog.returnsAsOf)}`}
        {` · «Nuevo» = añadido hace menos de ${NEW_DAYS} días`}
      </p>

      <div className="table-wrap">
        <table className="catalog">
          <thead>
            <tr>
              {th('name', 'Nombre')}
              <th>{type === 'plan' ? 'Gestora' : 'Categoría'}</th>
              {th('totalCost', type === 'etf' ? 'TER' : 'Coste total', 'num')}
              {type === 'fondo' && th('return3y', 'Rent. 3 a', 'num')}
              {type === 'fondo' && th('return5y', 'Rent. 5 a', 'num')}
              {type === 'fondo' && <th>Plataformas</th>}
              {type === 'etf' && <th>Ticker</th>}
              {type === 'etf' && <th>Dividendos</th>}
              {type === 'plan' && <th className="num">RV / RF</th>}
              {type === 'plan' && <th>Código DGS</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => <Row key={p.id} p={p} />)}
          </tbody>
        </table>
        {!rows.length && <p className="empty">Ningún producto coincide con los filtros.</p>}
      </div>
    </section>
  );
}

function Row({ p }: { p: Product }) {
  const link = productLink(p);
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
          {link ? <a href={link} target="_blank" rel="noreferrer">{p.name}</a> : p.name}
          {isNew(p) && <span className="badge-new" title={`Añadido el ${fmtDate(p.addedAt)}`}>Nuevo</span>}
        </div>
        <div className="muted small mono">
          {p.isin ?? p.dgsCode ?? ''}
          {p.index && <span className="index"> · {p.index}</span>}
        </div>
      </td>
      <td data-label={p.type === 'plan' ? 'Gestora' : 'Categoría'}>
        {p.type === 'plan' ? p.provider : (
          <>
            <span className={`tag ${p.assetClass === 'Renta Fija' ? 'tag-rf' : p.assetClass === 'Multiactivo' ? 'tag-mix' : 'tag-rv'}`}>
              {p.assetClass === 'Renta Variable' ? 'RV' : p.assetClass === 'Renta Fija' ? 'RF' : 'Mixto'}
            </span>{' '}
            {p.region ?? ''}
          </>
        )}
      </td>
      <td data-label={p.type === 'etf' ? 'TER' : 'Coste total'} className="num" title={costDetail}>
        <strong>{fmtPct(p.totalCost, p.type === 'plan' ? 3 : 2)}</strong>
      </td>
      {p.type === 'fondo' && <td data-label="Rent. 3 años" className="num">{fmtPct(p.return3y)}</td>}
      {p.type === 'fondo' && <td data-label="Rent. 5 años" className="num">{fmtPct(p.return5y)}</td>}
      {p.type === 'fondo' && (
        <td data-label="Plataformas">
          <div className="platforms">
            {p.platforms?.length ? p.platforms.map((pl) => <span key={pl} className="pill">{pl}</span>) : <span className="muted">—</span>}
          </div>
        </td>
      )}
      {p.type === 'etf' && <td data-label="Ticker" className="mono">{p.ticker}</td>}
      {p.type === 'etf' && <td data-label="Dividendos">{p.distribution ?? '—'}{p.currency && p.currency !== 'EUR' ? ` · ${p.currency}` : ''}</td>}
      {p.type === 'plan' && <td data-label="RV / RF" className="num">{p.equityPct != null ? `${p.equityPct} / ${100 - p.equityPct}` : '—'}</td>}
      {p.type === 'plan' && <td data-label="Código DGS" className="mono">{p.dgsCode ?? '—'}</td>}
    </tr>
  );
}
