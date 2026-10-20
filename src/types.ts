export type ProductType = 'fondo' | 'etf' | 'plan';

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
