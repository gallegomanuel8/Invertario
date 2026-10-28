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

// ---- Prices (valor liquidativo) ----

export interface NavPoint { price: number; date: string } // date: YYYY-MM-DD
export interface PriceInfo { isin: string; currency: string; current: NavPoint; base: NavPoint | null }

const MONTHS: Record<string, string> = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };
const ftDate = (s: string) => {
  const m = /([A-Z][a-z]{2})\w* (\d{1,2}),? (\d{4})/.exec(s);
  return m ? `${m[3]}-${MONTHS[m[1]]}-${m[2].padStart(2, '0')}` : null;
};
const ymd = (d: string) => d.replace(/-/g, '/');

/** Latest NAV on or before `since` from FT's historical-prices endpoint (needs FT's internal xid). */
async function navOnOrBefore(xid: string, since: string): Promise<NavPoint | null> {
  const start = new Date(since);
  start.setDate(start.getDate() - 14); // covers weekends and holidays
  const url = `https://markets.ft.com/data/equities/ajax/get-historical-prices?startDate=${ymd(start.toISOString().slice(0, 10))}&endDate=${ymd(since)}&symbol=${xid}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) return null;
  const { html } = (await res.json()) as { html?: string };
  let best: NavPoint | null = null;
  for (const row of (html ?? '').split('</tr>')) {
    const date = ftDate(row.replace(/<[^>]+>/g, ' '));
    const cells = [...row.matchAll(/<td>([\d.,]+)<\/td>/g)].map((m) => Number(m[1].replace(/,/g, '')));
    const close = cells[3];
    if (date && date <= since && Number.isFinite(close) && (!best || date > best.date)) best = { price: close, date };
  }
  return best;
}

export async function lookupPrices(isin: string, since: string | null): Promise<PriceInfo | null> {
  for (const ccy of ['EUR', 'USD', 'GBP']) {
    const res = await fetch(`https://markets.ft.com/data/funds/tearsheet/summary?s=${isin}:${ccy}`, { headers: { 'User-Agent': UA }, redirect: 'manual' });
    if (res.status !== 200) continue;
    const html = await res.text();
    const price = Number(/Price \(([A-Z]{3})\)[\s\S]{0,200}?mod-ui-data-list__value">([\d.,]+)/.exec(html)?.[2]?.replace(/,/g, ''));
    const date = ftDate(/as of ([A-Z][a-z]{2} \d{1,2} \d{4})/.exec(html)?.[1] ?? '');
    if (!Number.isFinite(price) || !date) continue;
    const xid = /&quot;xid&quot;:&quot;(\d+)&quot;/.exec(html)?.[1];
    const base = since && xid ? await navOnOrBefore(xid, since).catch(() => null) : null;
    return { isin, currency: ccy, current: { price, date }, base };
  }
  return null;
}

/** Shared HTTP handler (Vercel function and Vite dev middleware). */
export async function handle(url: URL): Promise<Response> {
  const isin = (url.searchParams.get('isin') ?? '').toUpperCase().trim();
  // Cache only at Vercel's edge: browsers must not cache (the app already throttles requests, and
  // browser stale-while-revalidate would fire extra background requests).
  const json = (body: unknown, status: number, cache: string) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...(cache === 'no-store' ? {} : { 'Vercel-CDN-Cache-Control': cache }) },
    });
  if (!ISIN_RE.test(isin)) return json({ error: 'ISIN no válido' }, 400, 'no-store');
  // ?since=YYYY-MM-DD → current NAV plus the NAV on/before that date (to rescale CSV market values).
  const since = url.searchParams.get('since');
  if (since !== null) {
    if (since && !/^\d{4}-\d{2}-\d{2}$/.test(since)) return json({ error: 'Fecha no válida' }, 400, 'no-store');
    const prices = await lookupPrices(isin, since || null).catch(() => null);
    if (!prices) return json({ error: 'Sin precio' }, 404, 's-maxage=3600');
    return json(prices, 200, 's-maxage=3600, stale-while-revalidate=3600');
  }
  const info = await lookupFund(isin);
  // Cache at the edge for a week: fund metadata changes rarely and this keeps FT.com traffic minimal.
  if (!info) return json({ error: 'No encontrado' }, 404, 's-maxage=86400');
  return json(info, 200, 's-maxage=604800, stale-while-revalidate=86400');
}

// GET /api/fund?isin=XX0000000000 → FundInfo; with &since=YYYY-MM-DD → PriceInfo. Receives only the ISIN (and a date).
// Kept in a single file: Vercel runs it as native ESM, where extensionless relative imports fail.
export function GET(request: Request) {
  return handle(new URL(request.url));
}
