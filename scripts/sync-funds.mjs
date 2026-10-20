#!/usr/bin/env node
// Downloads the community spreadsheet (public CSV export of each tab), normalises it
// into src/data/funds.json and keeps track of when each product first appeared.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SHEET_ID = '1qTBkH0K5zE-e5OXsUo6Prmo2QGmYNWf63Y-iLQqdBaA';
const TABS = { funds: '0', etfs: '1366659631', pensions: '2086398400' };
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'data', 'funds.json');

const ASSET_CLASSES = ['Renta Variable', 'Renta Fija', 'Multiactivo'];
const ISIN_RE = /^[A-Z]{2}[A-Z0-9]{9}\d$/;
const MS_ID_RE = /^(F0|0P)[0-9A-Z]{8}$/;

export function parseCSV(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.map((r) => r.map((v) => v.trim()));
}

const num = (v) => {
  if (!v || v === 'N/A') return null;
  const n = Number(v.replace('%', '').replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};
const bool = (v) => v.toUpperCase() === 'TRUE';
const isEmpty = (cells) => cells.every((c) => !c);
const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const esDate = (v) => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(v ?? '');
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};

async function fetchTab(gid) {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${gid}`;
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching gid=${gid}`);
  return parseCSV(await res.text());
}

// Walks a tab tracking the current asset class / region header rows.
function walk(rows, onProduct) {
  let assetClass = null, region = null;
  for (const r of rows) {
    const [first, second, third] = r;
    if (ISIN_RE.test(third ?? '')) { onProduct(r, assetClass, region); continue; }
    if (!first || first.endsWith(':') || second && !esDate(second)) continue;
    if (ASSET_CLASSES.includes(first)) { assetClass = first; region = null; }
    else if (isEmpty(r.slice(2, 7))) region = first;
  }
}

function parseFunds(rows) {
  const platforms = rows[1].slice(9, 15);
  const platformNotes = Object.fromEntries(platforms.map((p, i) => [p, rows[2][9 + i] || null]));
  const returnsAsOf = esDate(rows.find((r) => esDate(r[7]))?.[7]);
  const sourceUpdatedAt = esDate(rows.find((r) => r[0] === 'actualizado:')?.[1]);
  const items = [];
  walk(rows, (r, assetClass, region) => {
    items.push({
      id: r[2], type: 'fondo', isin: r[2], name: r[1], assetClass, region,
      morningstarId: MS_ID_RE.test(r[0]) ? r[0] : null,
      ter: num(r[3]), operatingCosts: num(r[4]), totalCost: num(r[5]),
      index: r[6] || null, return3y: num(r[7]), return5y: num(r[8]),
      platforms: platforms.filter((_, i) => bool(r[9 + i])),
      securitiesLending: r[15] || r[16] || r[17]
        ? { lent: r[15] || null, income: r[16] || null, collateral: r[17] || null }
        : null,
    });
  });
  return { items, platforms, platformNotes, returnsAsOf, sourceUpdatedAt };
}

function parseEtfs(rows) {
  const items = [];
  walk(rows, (r, assetClass, region) => {
    items.push({
      id: r[2], type: 'etf', isin: r[2], name: r[1], assetClass, region,
      ter: num(r[3]), totalCost: num(r[3]),
      distribution: r[4].startsWith('Distrib') ? 'Distribución' : r[4].startsWith('Acum') ? 'Acumulación' : null,
      currency: r[5] || null, ticker: r[6] || null, degiroExchange: r[7] || null,
    });
  });
  return items;
}

function parsePensions(rows) {
  const items = [];
  let provider = null, mgmtFee = null;
  for (const r of rows.slice(2)) {
    const [name, code, fee, fundsFee, otherFee, total, mix] = r;
    if (!name) continue;
    if (!code && isEmpty(r.slice(2, 7))) { provider = name; mgmtFee = null; continue; }
    if (!code) continue;
    if (fee) mgmtFee = num(fee);
    const [equity] = (mix || '').split('/').map((s) => num(s));
    items.push({
      id: `pp-${slug(name)}`, type: 'plan', isin: null, name, provider,
      assetClass: equity === 100 ? 'Renta Variable' : equity === 0 ? 'Renta Fija' : 'Multiactivo',
      region: provider, dgsCode: code === 'N/A' ? null : code,
      managementFee: mgmtFee, fundsFee: num(fundsFee), otherFees: num(otherFee),
      totalCost: num(total), equityPct: equity ?? null,
    });
  }
  return items;
}

async function main() {
  const [fundRows, etfRows, ppRows] = await Promise.all([fetchTab(TABS.funds), fetchTab(TABS.etfs), fetchTab(TABS.pensions)]);
  const funds = parseFunds(fundRows);
  const items = [...funds.items, ...parseEtfs(etfRows), ...parsePensions(ppRows)];
  if (items.length < 50) throw new Error(`Only ${items.length} products parsed, sheet layout probably changed`);

  let previous = null;
  try { previous = JSON.parse(await readFile(OUT, 'utf8')); } catch { /* first run */ }
  const today = new Date().toISOString().slice(0, 10);
  // First run is the baseline: existing products get addedAt = null (not "new").
  const known = new Map((previous?.items ?? []).map((p) => [p.id, p.addedAt]));
  const seen = new Set();
  const merged = items
    .filter((p) => !seen.has(p.id) && seen.add(p.id))
    .map((p) => ({ ...p, addedAt: previous ? (known.has(p.id) ? known.get(p.id) : today) : null }));

  const data = {
    source: `https://docs.google.com/spreadsheets/d/${SHEET_ID}`,
    sourceUpdatedAt: funds.sourceUpdatedAt,
    returnsAsOf: funds.returnsAsOf,
    platforms: funds.platforms,
    platformNotes: funds.platformNotes,
    items: merged,
  };
  const contentChanged = JSON.stringify({ ...previous, syncedAt: undefined }) !== JSON.stringify(data);
  if (!contentChanged) { console.log('No changes'); return; }
  await writeFile(OUT, JSON.stringify({ syncedAt: today, ...data }, null, 2) + '\n');
  const added = merged.filter((p) => p.addedAt === today).map((p) => p.name);
  console.log(`Wrote ${merged.length} products${added.length ? `; new: ${added.join(', ')}` : ''}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
