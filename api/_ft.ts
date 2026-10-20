// Looks up a fund by ISIN on FT.com (public tearsheet), falling back to OpenFIGI for the name.
// Only the ISIN ever reaches this code: no amounts or other portfolio data.

export interface FundInfo {
  isin: string;
  name: string;
  category: string | null; // Morningstar category, e.g. "Global Large-Cap Blend Equity"
  assetClass: 'Renta Variable' | 'Renta Fija' | 'Multiactivo' | null;
  ongoingCharge: number | null; // % annual
  domicile: string | null;
  source: 'FT.com' | 'OpenFIGI';
  url: string | null;
}

export const ISIN_RE = /^[A-Z]{2}[A-Z0-9]{9}\d$/;
const UA = 'Mozilla/5.0 (compatible; Invertario/1.0; +https://github.com/gallegomanuel8/Invertario)';

const decode = (s: string) =>
  s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#39;|&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ').trim();

export function classify(category: string | null): FundInfo['assetClass'] {
  if (!category) return null;
  if (/allocation|mixed|multi-?asset|balanced/i.test(category)) return 'Multiactivo';
  if (/bond|fixed income|money market|govt|government|credit|inflation-linked/i.test(category)) return 'Renta Fija';
  if (/equity|stock|real estate|reit/i.test(category)) return 'Renta Variable';
  return null;
}

export function parseFtTearsheet(isin: string, html: string, url: string): FundInfo | null {
  const name = /mod-tearsheet-overview__header__name[^"]*"[^>]*>([^<]+)/.exec(html)?.[1];
  if (!name) return null;
  const fields = new Map<string, string>();
  for (const m of html.matchAll(/<th[^>]*>([\s\S]*?)<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/g)) {
    fields.set(decode(m[1]).toLowerCase(), decode(m[2]));
  }
  const pct = (v?: string) => {
    const m = /(-?\d+(?:\.\d+)?)%/.exec(v ?? '');
    return m ? Number(m[1]) : null;
  };
  const category = fields.get('morningstar category') || null;
  return {
    isin,
    name: decode(name),
    category: category && category !== '--' ? category : null,
    assetClass: classify(category),
    ongoingCharge: pct(fields.get('ongoing charge')) ?? pct(fields.get('net expense ratio')),
    domicile: fields.get('domicile') || null,
    source: 'FT.com',
    url,
  };
}

async function fromFt(isin: string): Promise<FundInfo | null> {
  for (const ccy of ['EUR', 'USD', 'GBP']) {
    const url = `https://markets.ft.com/data/funds/tearsheet/summary?s=${isin}:${ccy}`;
    const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'manual' });
    if (res.status !== 200) continue;
    const info = parseFtTearsheet(isin, await res.text(), url);
    if (info) return info;
  }
  return null;
}

async function fromOpenFigi(isin: string): Promise<FundInfo | null> {
  const res = await fetch('https://api.openfigi.com/v3/mapping', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify([{ idType: 'ID_ISIN', idValue: isin }]),
  });
  if (!res.ok) return null;
  const [first] = (await res.json()) as { data?: { name?: string; marketSector?: string }[] }[];
  const hit = first?.data?.[0];
  if (!hit?.name) return null;
  return {
    isin, name: hit.name, category: null, ongoingCharge: null, domicile: null, source: 'OpenFIGI', url: null,
    // OpenFIGI's sector is coarse (a mixed fund is "Equity"), so trust the name first.
    assetClass: classify(hit.name) ?? (/LIFESTRAT|ALLOC|MIXED|BALANC|MULTI/i.test(hit.name) ? 'Multiactivo'
      : /BOND|BD\b|GOVT|TREAS|CREDIT|AGG/i.test(hit.name) ? 'Renta Fija' : null),
  };
}

export async function lookupFund(isin: string): Promise<FundInfo | null> {
  try {
    const ft = await fromFt(isin);
    if (ft) return ft;
  } catch {
    /* fall through to OpenFIGI */
  }
  try {
    return await fromOpenFigi(isin);
  } catch {
    return null;
  }
}

/** Shared HTTP handler (Vercel function and Vite dev middleware). */
export async function handle(url: URL): Promise<Response> {
  const isin = (url.searchParams.get('isin') ?? '').toUpperCase().trim();
  const json = (body: unknown, status: number, cache: string) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': cache } });
  if (!ISIN_RE.test(isin)) return json({ error: 'ISIN no válido' }, 400, 'no-store');
  const info = await lookupFund(isin);
  // Cache at the edge for a week: fund metadata changes rarely and this keeps FT.com traffic minimal.
  if (!info) return json({ error: 'No encontrado' }, 404, 'public, s-maxage=86400');
  return json(info, 200, 'public, s-maxage=604800, stale-while-revalidate=86400');
}
