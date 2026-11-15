// 'accion': listed shares, only as products looked up by ISIN (never in the catalog).
export type ProductType = 'fondo' | 'etf' | 'plan' | 'alt' | 'accion';

export interface Product {
  id: string;
  type: ProductType;
  isin: string | null;
  name: string;
  assetClass: string | null;
  region: string | null;
  totalCost: number | null;
  ter?: number | null;
  addedAt: string | null;
  // fondos
  morningstarId?: string | null;
  operatingCosts?: number | null;
  index?: string | null;
  return3y?: number | null;
  return5y?: number | null;
  platforms?: string[];
  securitiesLending?: { lent: string | null; income: string | null; collateral: string | null } | null;
  // ETFs
  distribution?: string | null;
  currency?: string | null;
  ticker?: string | null;
  degiroExchange?: string | null;
  // cripto y materias primas (curated: ETN / ETC / ETF UCITS)
  structure?: 'ETN' | 'ETC' | 'ETF UCITS';
  backing?: string; // "Física" | "Sintética (swap)"
  exchange?: string | null;
  note?: string | null;
  curated?: boolean; // added by Invertario, not in the community sheet
  /** Looked up by ISIN outside the catalog (stored only in this browser). */
  external?: { source: string; url: string | null; domicile: string | null; checkedAt: string };
  // planes de pensiones
  provider?: string;
  dgsCode?: string | null;
  managementFee?: number | null;
  fundsFee?: number | null;
  otherFees?: number | null;
  equityPct?: number | null;
}

export interface Catalog {
  syncedAt: string;
  source: string;
  sourceUpdatedAt: string | null;
  returnsAsOf: string | null;
  platforms: string[];
  platformNotes: Record<string, string | null>;
  items: Product[];
}
