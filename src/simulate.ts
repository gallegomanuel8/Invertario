// Projection maths for simulated portfolios. Pure functions, no React.
import type { Product } from './types';
import type { ReturnMode, SimPortfolio } from './sims';

/** Long-term, deliberately prudent gross annual returns and volatilities by asset class (%). */
const PRUDENT = { equity: 6, bonds: 2.5 };
const VOL = { equity: 15, bonds: 5 };

/** Share of equities (0..1) for a product. */
export function equityShare(p: Product): number {
  if (p.equityPct != null) return p.equityPct / 100;
  if (p.assetClass === 'Renta Variable') return 1;
  if (p.assetClass === 'Renta Fija') return 0;
  const m = /(\d{2})%\s*Equity/i.exec(p.name) ?? /LifeStrategy\s*(\d{2})/i.exec(p.name); // Vanguard LifeStrategy 60% Equity
  return m ? Number(m[1]) / 100 : 0.5;
}

export interface FundAssumption {
  product: Product;
  weight: number; // normalised 0..1
  cost: number; // % annual
  netReturn: number; // % annual, after costs
  volatility: number; // % annual
  source: string; // where netReturn comes from, shown to the user
}

export function fundAssumption(p: Product, weight: number, mode: ReturnMode, custom?: number): FundAssumption {
  const eq = equityShare(p);
  const cost = p.totalCost ?? 0;
  const prudentGross = eq * PRUDENT.equity + (1 - eq) * PRUDENT.bonds;
  let netReturn = prudentGross - cost;
  let source = 'Prudente por tipo de activo';
  if (mode === 'historica' && p.return5y != null) {
    netReturn = p.return5y; // published returns are already net of the fund's costs
    source = 'Histórica 5 años (ya neta de costes)';
  } else if (mode === 'historica') {
    source = 'Sin histórico: prudente';
  } else if (mode === 'personalizada' && custom != null) {
    netReturn = custom - cost;
    source = 'Personalizada (bruta, menos costes)';
  }
  return { product: p, weight, cost, netReturn, volatility: eq * VOL.equity + (1 - eq) * VOL.bonds, source };
}

export interface YearRow {
  year: number;
  contributed: number; // cumulative, initial included
  value: number; // expected scenario
  low: number; // unfavourable scenario
  high: number; // favourable scenario
  noCosts: number; // expected scenario without fund costs
  real: number; // expected value in today's euros
}

export interface Projection {
  rows: YearRow[];
  netReturn: number;
  cost: number;
  volatility: number;
  goalYear: number | null;
}

/** z for the 10th/90th percentile: scenarios are "1 in 10" bad/good outcomes, not worst/best cases. */
const Z = 1.2816;

export function project(sim: SimPortfolio, funds: FundAssumption[]): Projection {
  const totalW = funds.reduce((a, f) => a + f.weight, 0) || 1;
  const w = funds.map((f) => f.weight / totalW);
  const netReturn = funds.reduce((a, f, i) => a + f.netReturn * w[i], 0);
  const cost = funds.reduce((a, f, i) => a + f.cost * w[i], 0);
  // Funds are assumed fully correlated: a simple, conservative upper bound on portfolio volatility.
  const volatility = funds.reduce((a, f, i) => a + f.volatility * w[i], 0);

  const years = Math.max(1, Math.min(60, Math.round(sim.years)));
  const run = (annualPct: number) => {
    const rm = Math.pow(1 + annualPct / 100, 1 / 12) - 1;
    let bal = sim.initial;
    const out: number[] = [];
    for (let y = 0; y < years; y++) {
      const monthly = sim.monthly * Math.pow(1 + sim.yearlyIncrease / 100, y);
      for (let m = 0; m < 12; m++) bal = (bal + monthly) * (1 + rm);
      out.push(bal);
    }
    return out;
  };

  const expected = run(netReturn);
  const noCosts = run(netReturn + cost);
  const rows: YearRow[] = [];
  let contributed = sim.initial;
  for (let y = 0; y < years; y++) {
    contributed += 12 * sim.monthly * Math.pow(1 + sim.yearlyIncrease / 100, y);
    const spread = (Z * volatility) / Math.sqrt(y + 1); // dispersion of the annualised return shrinks with time
    rows.push({
      year: y + 1,
      contributed,
      value: expected[y],
      low: run(netReturn - spread)[y],
      high: run(netReturn + spread)[y],
      noCosts: noCosts[y],
      real: expected[y] / Math.pow(1 + sim.inflation / 100, y + 1),
    });
  }
  const goalYear = sim.goal ? rows.find((r) => r.value >= sim.goal!)?.year ?? null : null;
  return { rows, netReturn, cost, volatility, goalYear };
}

export function toCsv(rows: YearRow[]) {
  const n = (v: number) => v.toFixed(2).replace('.', ',');
  const lines = ['Año;Aportado acumulado;Valor esperado;Escenario desfavorable;Escenario favorable;Sin comisiones;Valor en euros de hoy'];
  for (const r of rows) lines.push([r.year, n(r.contributed), n(r.value), n(r.low), n(r.high), n(r.noCosts), n(r.real)].join(';'));
  return lines.join('\n');
}

/** Splits weighted amounts into equity / fixed income exposure (mixed funds count proportionally). */
export function assetTypeSlices(items: { product?: Product; amount: number }[]) {
  let equity = 0, bonds = 0, unknown = 0;
  for (const { product, amount } of items) {
    if (!product) { unknown += amount; continue; }
    const eq = equityShare(product);
    equity += amount * eq;
    bonds += amount * (1 - eq);
  }
  return [
    { label: 'Renta variable', value: equity, color: 'var(--cat-1)' },
    { label: 'Renta fija', value: bonds, color: 'var(--cat-3)' },
    { label: 'Sin clasificar', value: unknown, color: 'var(--cat-other)' },
  ].filter((s) => s.value > 0);
}
