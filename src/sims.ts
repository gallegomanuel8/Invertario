// Simulated portfolios ("carteras simuladas"): a tiny browser-only store shared by the catalog and the simulator.
import { useSyncExternalStore } from 'react';

export type ReturnMode = 'prudente' | 'historica' | 'personalizada';

export interface SimFund {
  id: string; // catalog product id
  weight: number; // %
  customReturn?: number; // % annual, used in "personalizada" mode
}

export interface SimPortfolio {
  id: string;
  name: string;
  createdAt: string;
  funds: SimFund[];
  initial: number;
  monthly: number;
  yearlyIncrease: number; // % the monthly contribution grows each year
  years: number;
  inflation: number; // %
  goal: number | null;
  returnMode: ReturnMode;
}

const KEY = 'invertario.sims.v1';
const listeners = new Set<() => void>();
let state: SimPortfolio[] = load();

function load(): SimPortfolio[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as SimPortfolio[]) : [];
  } catch {
    return [];
  }
}

function commit(next: SimPortfolio[]) {
  state = next;
  try {
    if (next.length) localStorage.setItem(KEY, JSON.stringify(next));
    else localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable: keep in memory for this session */
  }
  listeners.forEach((l) => l());
}

export function useSims() {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l); },
    () => state,
  );
}

export function createSim(name: string, firstFundId?: string): SimPortfolio {
  const sim: SimPortfolio = {
    id: Math.random().toString(36).slice(2, 10),
    name: name.trim() || `Cartera ${state.length + 1}`,
    createdAt: new Date().toISOString(),
    funds: firstFundId ? [{ id: firstFundId, weight: 100 }] : [],
    initial: 1000,
    monthly: 200,
    yearlyIncrease: 0,
    years: 20,
    inflation: 2,
    goal: null,
    returnMode: 'prudente',
  };
  commit([...state, sim]);
  return sim;
}

export function updateSim(id: string, patch: Partial<SimPortfolio>) {
  commit(state.map((s) => (s.id === id ? { ...s, ...patch } : s)));
}

export function deleteSim(id: string) {
  commit(state.filter((s) => s.id !== id));
}

/** Adds a fund and rebalances everything to equal weights (the user can fine-tune afterwards). */
export function addFundToSim(simId: string, fundId: string) {
  const sim = state.find((s) => s.id === simId);
  if (!sim || sim.funds.some((f) => f.id === fundId)) return;
  updateSim(simId, { funds: equalWeights([...sim.funds, { id: fundId, weight: 0 }]) });
}

export function equalWeights(funds: SimFund[]): SimFund[] {
  if (!funds.length) return funds;
  const base = Math.floor(1000 / funds.length) / 10;
  const rest = Math.round((100 - base * funds.length) * 10) / 10;
  return funds.map((f, i) => ({ ...f, weight: i === 0 ? Math.round((base + rest) * 10) / 10 : base }));
}

// ---- Sharing: the whole portfolio travels inside the link (no server involved) ----

type Shared = Omit<SimPortfolio, 'id' | 'createdAt'>;

const toB64Url = (s: string) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64Url = (s: string) =>
  new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)));

/** Compact, versioned payload so links stay short. */
export function encodeSim(sim: SimPortfolio): string {
  const payload = {
    v: 1, n: sim.name,
    f: sim.funds.map((f) => (f.customReturn != null ? [f.id, f.weight, f.customReturn] : [f.id, f.weight])),
    i: sim.initial, m: sim.monthly, y: sim.years, u: sim.yearlyIncrease, x: sim.inflation, g: sim.goal, r: sim.returnMode,
  };
  return toB64Url(JSON.stringify(payload));
}

const num = (v: unknown, min: number, max: number, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;

/** Parses and sanitises a shared payload; returns null if it is not a valid Invertario portfolio. */
export function decodeSim(code: string, knownIds: Set<string>): (Shared & { dropped: number }) | null {
  try {
    const p = JSON.parse(fromB64Url(code));
    if (p?.v !== 1 || !Array.isArray(p.f)) return null;
    const rows = (p.f as unknown[]).slice(0, 30).filter((r): r is [string, number, number?] => Array.isArray(r) && typeof r[0] === 'string');
    const funds = rows.filter(([id]) => knownIds.has(id)).map(([id, w, c]) => ({
      id, weight: num(w, 0, 100, 0), ...(typeof c === 'number' && Number.isFinite(c) ? { customReturn: num(c, -50, 50, 0) } : {}),
    }));
    const modes: ReturnMode[] = ['prudente', 'historica', 'personalizada'];
    return {
      name: String(p.n ?? 'Cartera compartida').slice(0, 80),
      funds,
      initial: num(p.i, 0, 1e9, 1000),
      monthly: num(p.m, 0, 1e7, 200),
      years: Math.round(num(p.y, 1, 50, 20)),
      yearlyIncrease: num(p.u, 0, 50, 0),
      inflation: num(p.x, 0, 50, 2),
      goal: typeof p.g === 'number' && p.g > 0 ? num(p.g, 0, 1e12, 0) : null,
      returnMode: modes.includes(p.r) ? p.r : 'prudente',
      dropped: rows.length - funds.length,
    };
  } catch {
    return null;
  }
}

export function importSim(data: Shared): SimPortfolio {
  const taken = new Set(state.map((s) => s.name));
  let name = data.name;
  for (let i = 2; taken.has(name); i++) name = `${data.name} (${i})`;
  const sim: SimPortfolio = { ...data, name, id: Math.random().toString(36).slice(2, 10), createdAt: new Date().toISOString() };
  commit([...state, sim]);
  return sim;
}

export const shareUrl = (sim: SimPortfolio) =>
  `${location.origin}${location.pathname}#/simulador/compartida?c=${encodeSim(sim)}`;
