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
  kind?: 'stock'; // a listed share (acción) rather than a fund/ETF
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
  // ETF tearsheets often lack a category: their style box says whether the fund holds stocks or bonds.
  const style = (k: string) => (fields.get(k) ?? '--') !== '--';
  const styleClass = style('investment style (stocks)') ? 'Renta Variable' : style('investment style (bonds)') ? 'Renta Fija' : null;
  return {
    isin,
    name: decode(name),
    category: category && category !== '--' ? category : null,
    assetClass: classify(category) ?? styleClass,
    ongoingCharge: pct(fields.get('ongoing charge')) ?? pct(fields.get('net expense ratio')),
    domicile: fields.get('domicile') || null,
    source: 'FT.com',
    url,
  };
}

interface FigiHit { name?: string; marketSector?: string; securityType?: string; securityType2?: string }
const figiCache = new Map<string, Promise<FigiHit | null>>();
/** OpenFIGI's first mapping for an ISIN (memoised per instance: it is rate limited). */
function figi(isin: string): Promise<FigiHit | null> {
  let hit = figiCache.get(isin);
  if (!hit) {
    hit = fetch('https://api.openfigi.com/v3/mapping', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([{ idType: 'ID_ISIN', idValue: isin }]),
    })
      .then(async (res) => (res.ok ? ((await res.json()) as { data?: FigiHit[] }[])[0]?.data?.[0] ?? null : null))
      .catch(() => null);
    figiCache.set(isin, hit);
    hit.then((h) => { if (!h) figiCache.delete(isin); });
  }
  return hit;
}
const isShare = (h: FigiHit | null) =>
  h?.marketSector === 'Equity' && /common stock|preference|depositary|adr|gdr|reit|\bshare/i.test(`${h.securityType} ${h.securityType2}`);

// Euro venues first (Xetra, then the main eurozone exchanges): portfolio values are in euros.
const EXCHANGES = ['GER', 'AEX', 'PAR', 'MCE', 'MIL', 'BRU', 'LIS', 'VIE', 'HEL', 'DUB', 'FRA', 'MUN', 'STU', 'DUS', 'HAM', 'BER'];
const exchangeRank = (symbol: string) => {
  const ex = symbol.split(':')[1] ?? '';
  const i = EXCHANGES.indexOf(ex);
  return i < 0 ? EXCHANGES.length : i;
};
const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 1 && !['the', 'inc', 'nv', 'sa', 'ag', 'plc', 'se'].includes(w));

/**
 * Exchange-traded listings for an ISIN via FT's search. FT's search is full-text, so it also returns
 * products that merely mention the company: an ETF counts only if its page shows the ISIN, and a share
 * only if OpenFIGI says the ISIN is a share and the company names match.
 */
async function* ftListings(isin: string): AsyncGenerator<{ url: string; html: string; kind?: 'stock' }> {
  const res = await fetch(`https://markets.ft.com/data/search?query=${isin}`, { headers: { 'User-Agent': UA } });
  if (!res.ok) return;
  const page = await res.text();
  const rows = [...page.matchAll(/href="\/data\/(etfs|equities)\/tearsheet\/summary\?s=([A-Za-z0-9.:]+)"[^>]*>([^<]+)</g)]
    .map((m) => ({ kind: m[1], symbol: m[2], name: decode(m[3]) }));
  const unique = <T extends { symbol: string }>(xs: T[]) => xs.filter((x, i) => xs.findIndex((y) => y.symbol === x.symbol) === i);
  const etfRank = (s: string) => (s.endsWith(':GER:EUR') ? 0 : s.endsWith(':EUR') ? 1 : 2);
  const etfs = unique(rows.filter((r) => r.kind === 'etfs')).sort((a, b) => etfRank(a.symbol) - etfRank(b.symbol)).slice(0, 3);
  for (const e of etfs) {
    const url = `https://markets.ft.com/data/etfs/tearsheet/summary?s=${e.symbol}`;
    const r = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'manual' });
    if (r.status !== 200) continue;
    const html = await r.text();
    if (html.includes(isin)) { yield { url, html }; return; }
  }
  const shares = rows.filter((r) => r.kind === 'equities');
  if (!shares.length) return;
  const hit = await figi(isin);
  if (!isShare(hit)) return;
  const key = words(hit!.name ?? '')[0];
  const matching = unique(shares.filter((r) => key && words(r.name).includes(key)))
    .sort((a, b) => exchangeRank(a.symbol) - exchangeRank(b.symbol)).slice(0, 2);
  for (const sh of matching) {
    const url = `https://markets.ft.com/data/equities/tearsheet/summary?s=${sh.symbol}`;
    const r = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'manual' });
    if (r.status === 200) yield { url, html: await r.text(), kind: 'stock' };
  }
}

/** FT tearsheet pages for an ISIN: fund share classes by currency, then exchange-traded listings (ETF/ETC, shares). */
async function* ftPages(isin: string): AsyncGenerator<{ url: string; html: string; kind?: 'stock' }> {
  for (const ccy of ['EUR', 'USD', 'GBP']) {
    const url = `https://markets.ft.com/data/funds/tearsheet/summary?s=${isin}:${ccy}`;
    const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'manual' });
    if (res.status === 200) yield { url, html: await res.text() };
  }
  try {
    yield* ftListings(isin);
  } catch {
    /* search unavailable */
  }
}

async function fromFt(isin: string): Promise<FundInfo | null> {
  for await (const { url, html, kind } of ftPages(isin)) {
    const info = parseFtTearsheet(isin, html, url);
    if (!info) continue;
    return kind === 'stock' ? { ...info, kind, assetClass: 'Renta Variable', ongoingCharge: null, category: null } : info;
  }
  return null;
}

async function fromOpenFigi(isin: string): Promise<FundInfo | null> {
  const hit = await figi(isin);
  if (!hit?.name) return null;
  if (isShare(hit)) {
    return { isin, name: hit.name, category: null, ongoingCharge: null, domicile: null, source: 'OpenFIGI', url: null, assetClass: 'Renta Variable', kind: 'stock' };
  }
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
export interface PriceInfo { isin: string; currency: string; current: NavPoint; base: NavPoint | null; originalCurrency?: string }

/** ECB reference rate (units of EUR per 1 `ccy`) on or before `date`, from Frankfurter. Sends only the currency and date. */
async function eurRate(ccy: string, date: string): Promise<number | null> {
  const res = await fetch(`https://api.frankfurter.dev/v1/${date}?from=${ccy}&to=EUR`, { headers: { 'User-Agent': UA } });
  if (!res.ok) return null;
  const rate = ((await res.json()) as { rates?: { EUR?: number } }).rates?.EUR;
  return typeof rate === 'number' && rate > 0 ? rate : null;
}

/**
 * Share classes priced in USD/GBP/… are converted to euros with each day's rate: brokers value them in
 * euros, so the euro value moves with both the price and the exchange rate.
 */
async function inEuros(p: PriceInfo): Promise<PriceInfo> {
  if (p.currency === 'EUR' || !/^[A-Z]{3}$/.test(p.currency)) return p;
  const conv = async (n: NavPoint | null) => {
    if (!n) return null;
    const r = await eurRate(p.currency, n.date).catch(() => null);
    return r ? { date: n.date, price: Math.round(n.price * r * 10_000) / 10_000 } : undefined;
  };
  const [current, base] = await Promise.all([conv(p.current), conv(p.base)]);
  if (!current || base === undefined) return p; // no rate: keep the original currency (the app won't rescale)
  return { ...p, currency: 'EUR', originalCurrency: p.currency, current, base };
}

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
  for await (const { html } of ftPages(isin)) {
    const m = /Price \(([A-Z]{3})\)[\s\S]{0,200}?mod-ui-data-list__value">([\d.,]+)/.exec(html);
    const ccy = m?.[1] ?? '';
    const price = Number(m?.[2]?.replace(/,/g, ''));
    const date = ftDate(/as of ([A-Z][a-z]{2} \d{1,2} \d{4})/.exec(html)?.[1] ?? '');
    if (!Number.isFinite(price) || !date) continue;
    const xid = /&quot;xid&quot;:&quot;(\d+)&quot;/.exec(html)?.[1];
    const base = since && xid ? await navOnOrBefore(xid, since).catch(() => null) : null;
    return inEuros({ isin, currency: ccy, current: { price, date }, base });
  }
  return null;
}

export interface PriceHistory { isin: string; currency: string; source: string; points: [string, number][] } // [YYYY-MM-DD, close]

/** Weekly closes (last trading day of each week) for the last `years`, from FT's historical prices. */
export async function lookupHistory(isin: string, years: number): Promise<PriceHistory | null> {
  for await (const { url, html } of ftPages(isin)) {
    const ccy = /Price \(([A-Z]{3})\)/.exec(html)?.[1];
    const xid = /&quot;xid&quot;:&quot;(\d+)&quot;/.exec(html)?.[1];
    if (!ccy || !xid) continue;
    const end = new Date(), start = new Date();
    start.setFullYear(start.getFullYear() - years);
    const res = await fetch(`https://markets.ft.com/data/equities/ajax/get-historical-prices?startDate=${ymd(start.toISOString().slice(0, 10))}&endDate=${ymd(end.toISOString().slice(0, 10))}&symbol=${xid}`, { headers: { 'User-Agent': UA } });
    if (!res.ok) continue;
    const { html: rows } = (await res.json()) as { html?: string };
    const daily: [string, number][] = [];
    for (const row of (rows ?? '').split('</tr>')) {
      const date = ftDate(row.replace(/<[^>]+>/g, ' '));
      const close = [...row.matchAll(/<td>([\d.,]+)<\/td>/g)].map((m) => Number(m[1].replace(/,/g, '')))[3];
      if (date && Number.isFinite(close) && close > 0) daily.push([date, close]);
    }
    if (daily.length < 2) continue;
    daily.sort((a, b) => a[0].localeCompare(b[0]));
    // One point per ISO week keeps 5 years at ~260 points.
    const week = (d: string) => { const t = new Date(d); t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7)); return t.toISOString().slice(0, 10); };
    const points = daily.filter((p, i) => i === daily.length - 1 || week(daily[i + 1][0]) !== week(p[0]));
    return { isin, currency: ccy, source: url, points };
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
  // ?history=5y → weekly closes for the price chart in the product page.
  const history = url.searchParams.get('history');
  if (history !== null) {
    const years = Number(/^(\d{1,2})y$/.exec(history)?.[1]);
    if (!years || years > 10) return json({ error: 'Periodo no válido' }, 400, 'no-store');
    const h = await lookupHistory(isin, years).catch(() => null);
    if (!h) return json({ error: 'Sin histórico' }, 404, 's-maxage=86400');
    return json(h, 200, 's-maxage=43200, stale-while-revalidate=86400');
  }
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

// GET /api/fund?isin=XX0000000000 → FundInfo; with &since=YYYY-MM-DD → PriceInfo; with &history=5y → PriceHistory. Receives only the ISIN (and a date).
// Kept in a single file: Vercel runs it as native ESM, where extensionless relative imports fail.
export function GET(request: Request) {
  return handle(new URL(request.url));
}
