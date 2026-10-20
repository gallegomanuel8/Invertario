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
