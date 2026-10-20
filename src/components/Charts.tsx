import { useEffect, useRef, useState } from 'react';
import { fmtDate, fmtEur } from '../format';

export interface Point { date: string; value: number }

/** Single-series step-area chart with crosshair + tooltip. */
export function StepChart({ points, label }: { points: Point[]; label: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const [width, setWidth] = useState(640);
  const box = useRef<HTMLDivElement>(null);
  const ref = useRef<SVGSVGElement>(null);

  // Draw at the real pixel width so axis text stays legible on phones instead of being scaled down.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(240, Math.round(entry.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [points.length >= 2]);

  if (points.length < 2) return null;

  const W = width, H = width < 480 ? 200 : 240, pad = { l: 56, r: 12, t: 12, b: 28 };
  const t0 = new Date(points[0].date).getTime();
  const t1 = Math.max(new Date(points.at(-1)!.date).getTime(), t0 + 1);
  const max = niceMax(Math.max(...points.map((p) => p.value)));
  const x = (d: string) => pad.l + ((new Date(d).getTime() - t0) / (t1 - t0)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - v / max) * (H - pad.t - pad.b);

  let path = `M${x(points[0].date)},${y(points[0].value)}`;
  for (const p of points.slice(1)) path += ` H${x(p.date)} V${y(p.value)}`;
  const area = `${path} V${y(0)} H${x(points[0].date)} Z`;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const xTicks = W < 420 ? [points[0], points.at(-1)!] : [points[0], points[Math.floor(points.length / 2)], points.at(-1)!];

  const onMove = (e: React.PointerEvent) => {
    const box = ref.current!.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    let best = 0;
    points.forEach((p, i) => { if (Math.abs(x(p.date) - px) < Math.abs(x(points[best].date) - px)) best = i; });
    setHover(best);
  };
  const hp = hover != null ? points[hover] : null;

  return (
    <div className="chart" ref={box}>
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={label}
        onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="grid" />
            <text x={pad.l - 8} y={y(t)} className="axis" textAnchor="end" dominantBaseline="middle">{compactEur(t)}</text>
          </g>
        ))}
        {xTicks.map((p, i) => (
          <text key={i} x={x(p.date)} y={H - 8} className="axis" textAnchor={i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'}>
            {fmtDate(p.date)}
          </text>
        ))}
        <path d={area} className="series-area" />
        <path d={path} className="series-line" />
        {hp && (
          <g>
            <line x1={x(hp.date)} x2={x(hp.date)} y1={pad.t} y2={y(0)} className="crosshair" />
            <circle cx={x(hp.date)} cy={y(hp.value)} r={5} className="series-dot" />
          </g>
        )}
      </svg>
      {hp && (
        <div className="tooltip" style={{ left: `${(x(hp.date) / W) * 100}%` }}>
          <div className="muted small">{fmtDate(hp.date)}</div>
          <strong>{fmtEur(hp.value)}</strong>
        </div>
      )}
    </div>
  );
}

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
