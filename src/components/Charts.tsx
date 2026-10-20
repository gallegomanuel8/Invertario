import { useRef, useState } from 'react';
import { fmtDate, fmtEur } from '../format';

export interface Point { date: string; value: number }

/** Single-series step-area chart with crosshair + tooltip. */
export function StepChart({ points, label }: { points: Point[]; label: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const ref = useRef<SVGSVGElement>(null);
  if (points.length < 2) return null;

  const W = 640, H = 220, pad = { l: 56, r: 12, t: 12, b: 28 };
  const t0 = new Date(points[0].date).getTime();
  const t1 = Math.max(new Date(points.at(-1)!.date).getTime(), t0 + 1);
  const max = niceMax(Math.max(...points.map((p) => p.value)));
  const x = (d: string) => pad.l + ((new Date(d).getTime() - t0) / (t1 - t0)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - v / max) * (H - pad.t - pad.b);

  let path = `M${x(points[0].date)},${y(points[0].value)}`;
  for (const p of points.slice(1)) path += ` H${x(p.date)} V${y(p.value)}`;
  const area = `${path} V${y(0)} H${x(points[0].date)} Z`;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const xTicks = [points[0], points[Math.floor(points.length / 2)], points.at(-1)!];

  const onMove = (e: React.PointerEvent) => {
    const box = ref.current!.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    let best = 0;
    points.forEach((p, i) => { if (Math.abs(x(p.date) - px) < Math.abs(x(points[best].date) - px)) best = i; });
    setHover(best);
  };
  const hp = hover != null ? points[hover] : null;

  return (
    <div className="chart">
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}
        onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="grid" />
            <text x={pad.l - 8} y={y(t)} className="axis" textAnchor="end" dominantBaseline="middle">{compactEur(t)}</text>
          </g>
        ))}
        {xTicks.map((p, i) => (
          <text key={i} x={x(p.date)} y={H - 8} className="axis" textAnchor={i === 0 ? 'start' : i === 2 ? 'end' : 'middle'}>
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
