import { useEffect, useRef, useState } from 'react';
import { fmtEur } from '../format';

/** Horizontal bars, single hue (magnitude), every bar direct-labelled. */
export function BarList({ items }: { items: { label: string; value: number; hint?: string }[] }) {
  const total = items.reduce((a, b) => a + b.value, 0);
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <ul className="barlist">
      {items.map((i) => (
        <li key={i.label} title={`${i.label}: ${fmtEur(i.value)} (${((i.value / total) * 100).toFixed(1)} %)`}>
          <div className="barlist-label">
            <span>{i.label}{i.hint && <span className="muted small"> · {i.hint}</span>}</span>
            <span className="num">{((i.value / total) * 100).toFixed(1).replace('.', ',')} %</span>
          </div>
          <div className="bar-track"><div className="bar" style={{ width: `${(i.value / max) * 100}%` }} /></div>
        </li>
      ))}
    </ul>
  );
}

function niceMax(v: number) {
  if (v <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(v));
  return [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map((m) => m * mag).find((m) => m >= v)!;
}

function compactEur(v: number) {
  return new Intl.NumberFormat('es-ES', { notation: 'compact', maximumFractionDigits: 1 }).format(v) + ' €';
}

export interface BandPoint { x: number; label: string; value: number; low: number; high: number; base: number }

/** Projection chart: expected line, favourable/unfavourable band and contributed baseline, with crosshair tooltip. */
export function ProjectionChart({ points, label }: { points: BandPoint[]; label: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const [width, setWidth] = useState(640);
  const box = useRef<HTMLDivElement>(null);
  const ref = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(240, Math.round(entry.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const W = width, H = width < 480 ? 220 : 280, pad = { l: 60, r: 12, t: 12, b: 28 };
  const n = points.length;
  const max = niceMax(Math.max(1, ...points.map((p) => p.high)));
  const x = (i: number) => pad.l + (n <= 1 ? 0 : (i / (n - 1)) * (W - pad.l - pad.r));
  const y = (v: number) => pad.t + (1 - v / max) * (H - pad.t - pad.b);
  const line = (get: (p: BandPoint) => number) => points.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(get(p))}`).join(' ');
  const band = `${line((p) => p.high)} ${points.map((_, i) => `L${x(n - 1 - i)},${y(points[n - 1 - i].low)}`).join(' ')} Z`;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const step = Math.max(1, Math.ceil(n / (W < 480 ? 4 : 8)));

  const onMove = (e: React.PointerEvent) => {
    const rect = ref.current!.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    setHover(Math.max(0, Math.min(n - 1, Math.round(((px - pad.l) / (W - pad.l - pad.r)) * (n - 1)))));
  };
  const hp = hover != null ? points[hover] : null;

  return (
    <div className="chart" ref={box}>
      <ul className="legend" aria-hidden>
        <li><span className="key key-line" />Valor esperado</li>
        <li><span className="key key-band" />Escenarios favorable y desfavorable</li>
        <li><span className="key key-base" />Aportado</li>
      </ul>
      {n > 1 && (
        <svg ref={ref} viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={label}
          onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="grid" />
              <text x={pad.l - 8} y={y(t)} className="axis" textAnchor="end" dominantBaseline="middle">{compactEur(t)}</text>
            </g>
          ))}
          {points.map((p, i) => ((i % step === 0 && n - 1 - i >= step * 0.6) || i === n - 1) && (
            <text key={i} x={x(i)} y={H - 8} className="axis" textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}>{p.label}</text>
          ))}
          <path d={band} className="series-band" />
          <path d={line((p) => p.base)} className="series-base" />
          <path d={line((p) => p.value)} className="series-line" />
          {hp && (
            <g>
              <line x1={x(hover!)} x2={x(hover!)} y1={pad.t} y2={y(0)} className="crosshair" />
              <circle cx={x(hover!)} cy={y(hp.value)} r={5} className="series-dot" />
            </g>
          )}
        </svg>
      )}
      {hp && (
        <div className="tooltip" style={{ left: `${Math.min(80, Math.max(20, (x(hover!) / W) * 100))}%`, top: 40 }}>
          <div className="muted small">{hp.label}</div>
          <div><strong>{fmtEur(hp.value)}</strong> <span className="muted small">esperado</span></div>
          <div className="small">{fmtEur(hp.low)} – {fmtEur(hp.high)}</div>
          <div className="small muted">Aportado: {fmtEur(hp.base)}</div>
        </div>
      )}
    </div>
  );
}

export interface Slice { label: string; value: number; color?: string; hint?: string }

const MAX_SLICES = 6;

/** Folds the tail into "Otros" so the donut never carries more than MAX_SLICES segments. */
export function foldSlices(items: Slice[]): Slice[] {
  const sorted = [...items].filter((i) => i.value > 0).sort((a, b) => b.value - a.value);
  if (sorted.length <= MAX_SLICES) return sorted;
  const head = sorted.slice(0, MAX_SLICES - 1);
  const tail = sorted.slice(MAX_SLICES - 1);
  return [...head, { label: `Otros (${tail.length})`, value: tail.reduce((a, b) => a + b.value, 0), color: 'var(--cat-other)', hint: tail.map((t) => t.label).join(', ') }];
}

/** Part-to-whole donut with a legend that always shows label, share and amount (identity never by color alone). */
export function Donut({ title, slices, format, center }: {
  title: string;
  slices: Slice[];
  format?: (v: number) => string;
  center?: { label: string; value: string };
}) {
  const [active, setActive] = useState<number | null>(null);
  const data = foldSlices(slices).map((s, i) => ({ ...s, color: s.color ?? `var(--cat-${i + 1})` }));
  const total = data.reduce((a, b) => a + b.value, 0);
  if (!total) return null;

  const size = 168, stroke = 26, r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const gap = data.length > 1 ? 2 : 0; // 2px surface gap between segments
  let offset = 0;
  const pct = (v: number) => `${((v / total) * 100).toFixed(1).replace('.', ',')} %`;
  const shown = active != null ? data[active] : null;

  return (
    <figure className="donut">
      <figcaption className="donut-title">{title}</figcaption>
      <div className="donut-body">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img"
          aria-label={`${title}: ${data.map((d) => `${d.label} ${pct(d.value)}`).join(', ')}`}>
          <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
            {data.map((d, i) => {
              const len = (d.value / total) * c;
              const seg = (
                <circle key={d.label} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={d.color}
                  strokeWidth={active === i ? stroke + 6 : stroke}
                  strokeDasharray={`${Math.max(0.5, len - gap)} ${c}`} strokeDashoffset={-offset}
                  opacity={active != null && active !== i ? 0.35 : 1}
                  onPointerEnter={() => setActive(i)} onPointerLeave={() => setActive(null)} className="donut-seg" />
              );
              offset += len;
              return seg;
            })}
          </g>
          <text x="50%" y="46%" textAnchor="middle" className="donut-center-label">{shown ? shown.label.slice(0, 18) + (shown.label.length > 18 ? '…' : '') : center?.label}</text>
          <text x="50%" y="58%" textAnchor="middle" className="donut-center-value">{shown ? pct(shown.value) : center?.value}</text>
        </svg>
        <ul className="donut-legend">
          {data.map((d, i) => (
            <li key={d.label} className={`${active === i ? 'active' : ''}${format ? '' : ' no-amount'}`} title={d.hint ? `${d.label}: ${d.hint}` : d.label}
              onPointerEnter={() => setActive(i)} onPointerLeave={() => setActive(null)}>
              <span className="swatch" style={{ background: d.color }} aria-hidden />
              <span className="donut-label">{d.label}</span>
              <span className="num">{pct(d.value)}</span>
              {format && <span className="num muted small">{format(d.value)}</span>}
            </li>
          ))}
        </ul>
      </div>
    </figure>
  );
}

export interface TimelinePast { t: number; contributed: number }
export interface TimelineFuture { t: number; contributed: number; value: number; low: number; high: number }

/**
 * Real history (contributions, today's value) followed by a projection to a horizon:
 * contributed line across the whole span, expected value + scenario band after "Hoy".
 */
export function TimelineChart({ past, today, future, label }: {
  past: TimelinePast[];
  today: { t: number; contributed: number; value: number };
  future: TimelineFuture[];
  label: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [width, setWidth] = useState(640);
  const box = useRef<HTMLDivElement>(null);
  const ref = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(240, Math.round(entry.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // One timeline for hover: past contributions, today, then projected months.
  type P = { t: number; contributed: number; value?: number; low?: number; high?: number; kind: 'past' | 'today' | 'future' };
  const pts: P[] = [
    ...past.filter((p) => p.t < today.t).map((p) => ({ ...p, kind: 'past' as const })),
    { ...today, low: today.value, high: today.value, kind: 'today' },
    ...future.map((p) => ({ ...p, kind: 'future' as const })),
  ];
  const W = width, H = width < 480 ? 230 : 290, pad = { l: 60, r: 14, t: 16, b: 28 };
  const t0 = pts[0].t, t1 = Math.max(pts.at(-1)!.t, t0 + 1);
  const max = niceMax(Math.max(1, ...pts.map((p) => Math.max(p.high ?? 0, p.contributed, p.value ?? 0))));
  const x = (t: number) => pad.l + ((t - t0) / (t1 - t0)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - v / max) * (H - pad.t - pad.b);

  // Contributions are steps (money arrives on dates); projection lines are smooth.
  const pastPts = pts.filter((p) => p.kind !== 'future');
  let basePast = `M${x(pastPts[0].t)},${y(pastPts[0].contributed)}`;
  for (const p of pastPts.slice(1)) basePast += ` H${x(p.t)} V${y(p.contributed)}`;
  const fut = pts.filter((p) => p.kind !== 'past');
  const line = (get: (p: P) => number) => fut.map((p, i) => `${i ? 'L' : 'M'}${x(p.t)},${y(get(p))}`).join(' ');
  const band = fut.length > 1
    ? `${line((p) => p.high!)} ${[...fut].reverse().map((p) => `L${x(p.t)},${y(p.low!)}`).join(' ')} Z` : '';
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  // Axis ticks: years for long spans, months when the whole chart covers less than ~3 years.
  const maxTicks = W < 480 ? 4 : 8;
  const spanMonths = (t1 - t0) / (30.44 * 86_400_000);
  const ticksX: { t: number; label: string }[] = [];
  if (spanMonths > 36) {
    const y0 = new Date(t0).getFullYear(), y1 = new Date(t1).getFullYear();
    const every = Math.max(1, Math.ceil((y1 - y0) / maxTicks));
    for (let yr = y0 + 1; yr <= y1; yr += every) ticksX.push({ t: new Date(yr, 0, 1).getTime(), label: String(yr) });
  } else {
    const every = Math.max(1, Math.ceil(spanMonths / maxTicks));
    const d = new Date(t0); d.setDate(1); d.setMonth(d.getMonth() + 1);
    const fmt = new Intl.DateTimeFormat('es-ES', { month: 'short', year: '2-digit' });
    for (; d.getTime() <= t1; d.setMonth(d.getMonth() + every)) ticksX.push({ t: d.getTime(), label: fmt.format(d) });
  }

  const onMove = (e: React.PointerEvent) => {
    const rect = ref.current!.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    let best = 0;
    pts.forEach((p, i) => { if (Math.abs(x(p.t) - px) < Math.abs(x(pts[best].t) - px)) best = i; });
    setHover(best);
  };
  const hp = hover != null ? pts[hover] : null;
  const fmtMonth = (t: number) => new Intl.DateTimeFormat('es-ES', { month: 'short', year: 'numeric' }).format(t);

  return (
    <div className="chart" ref={box}>
      <ul className="legend" aria-hidden>
        <li><span className="key key-base" />Aportado</li>
        <li><span className="key key-dot" />Valor actual</li>
        {future.length > 0 && <li><span className="key key-line" />Valor esperado</li>}
        {future.length > 0 && <li><span className="key key-band" />Escenarios favorable y desfavorable</li>}
      </ul>
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={label}
        onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="grid" />
            <text x={pad.l - 8} y={y(t)} className="axis" textAnchor="end" dominantBaseline="middle">{compactEur(t)}</text>
          </g>
        ))}
        {ticksX.map((tk) => (
          <text key={tk.t} x={x(tk.t)} y={H - 8} className="axis" textAnchor="middle">{tk.label}</text>
        ))}
        {future.length > 0 && <rect x={x(today.t)} y={pad.t} width={x(t1) - x(today.t)} height={y(0) - pad.t} className="future-zone" />}
        {band && <path d={band} className="series-band" />}
        <path d={basePast} className="series-base series-base-solid" />
        {future.length > 0 && <path d={line((p) => p.contributed)} className="series-base" />}
        {future.length > 0 && <path d={line((p) => p.value!)} className="series-line" />}
        <line x1={x(today.t)} x2={x(today.t)} y1={pad.t} y2={y(0)} className="today-line" />
        <text x={x(today.t)} y={pad.t - 4} className="axis" textAnchor={x(today.t) > W - 40 ? 'end' : 'middle'}>Hoy</text>
        <line x1={x(today.t)} x2={x(today.t)} y1={y(today.contributed)} y2={y(today.value)} className={today.value >= today.contributed ? 'gain-line' : 'loss-line'} />
        <circle cx={x(today.t)} cy={y(today.value)} r={5} className="series-dot" />
        {hp && (
          <g>
            <line x1={x(hp.t)} x2={x(hp.t)} y1={pad.t} y2={y(0)} className="crosshair" />
            {hp.value != null && <circle cx={x(hp.t)} cy={y(hp.value)} r={4} className="series-dot" />}
          </g>
        )}
      </svg>
      {hp && (
        <div className="tooltip" style={{ left: `${Math.min(80, Math.max(20, (x(hp.t) / W) * 100))}%`, top: 44 }}>
          <div className="muted small">{hp.kind === 'today' ? 'Hoy' : fmtMonth(hp.t)}{hp.kind === 'future' ? ' · estimación' : ''}</div>
          {hp.value != null && <div><strong>{fmtEur(hp.value)}</strong> <span className="muted small">{hp.kind === 'today' ? 'valor actual' : 'esperado'}</span></div>}
          {hp.kind === 'future' && <div className="small">{fmtEur(hp.low!)} – {fmtEur(hp.high!)}</div>}
          <div className="small muted">Aportado: {fmtEur(hp.contributed)}</div>
        </div>
      )}
    </div>
  );
}
