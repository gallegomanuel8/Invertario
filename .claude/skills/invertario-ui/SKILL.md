---
name: invertario-ui
description: UI/UX rules and visual verification workflow for the Invertario web app (Vite + React + TS, plain CSS tokens, Spanish UI). Use this skill whenever you touch anything users see in Invertario — new components, layout or style changes, the fund catalog table, filters, the "Mi cartera" dashboard, charts, empty/error states, copy text, responsive/mobile fixes, dark mode — or when the user asks to improve, polish, redesign, review or audit the web's design, usability or accessibility, even if they don't say "UI" or "UX" explicitly.
---

# Invertario UI/UX

Invertario is a small, fast, no-backend site for Spanish retail investors: a catalog of index funds/ETFs/pension plans (from a community spreadsheet) and a private portfolio dashboard fed by CSVs that never leave the browser. Users are non-professional investors, often on mobile, comparing costs. Every design decision should make **comparing products** and **understanding my portfolio** faster, while keeping the site trustworthy and calm (it's money).

Code map: `src/styles.css` (all styles + tokens), `src/components/Catalog.tsx`, `src/components/Portfolio.tsx`, `src/components/Charts.tsx`, `src/format.ts` (all number/date formatting), `src/data.ts`.

## Workflow

1. **Read before changing.** Open `src/styles.css` and the component you'll touch. Reuse existing classes and tokens (`.panel`, `.kpi`, `.chip`, `.pill`, `.tag-*`, `.btn`, `.link`, `.table-wrap`, `.muted`, `.small`, `.num`, `.pos/.neg`) before inventing new ones — consistency is most of what makes a small site feel designed.
2. **Make the change** following the rules below.
3. **Verify visually.** Run `bash .claude/skills/invertario-ui/scripts/screenshots.sh <dir>` and look at every PNG it prints (desktop, mobile 390px, dark mode, catalog + portfolio seeded with fictional demo data). `npm run build` passing is not verification — layout bugs (horizontal overflow on mobile, clipped labels, unreadable dark-mode colors) only show up in pixels. Fix and re-shoot until clean.
4. **Report** what changed and what you checked, mentioning anything you could not verify.

## Rules

### Tokens & theming
- Colors only via CSS custom properties on `:root`. Any new token needs a value in **three places**: `:root`, the `@media (prefers-color-scheme: dark) :root:not([data-theme='light'])` block, and `:root[data-theme='dark']`. A token missing in dark mode is the most common regression.
- Gains use `--pos`, losses `--neg`, and **always with a sign** (`+12,30 €`, `-2,04 %`) via `fmtSignedEur`/`fmtSignedPct` — never color alone (colorblind users, print).
- "Nuevo" badge uses `--new`/`--new-bg`; don't reuse those colors for anything else, or the signal gets diluted.

### Language & formatting
- All UI copy in **Spanish (España)**, sentence case, concise, tuteo ("Importa tus CSV", not "Importe"). Financial terms as Spanish investors use them: *coste total, TER, rentabilidad anualizada, plusvalías, lotes, traspaso, comercializadora, renta variable/fija*.
- Never format numbers by hand: use `src/format.ts` (`es-ES` → `1.234,56 €`, `0,12 %`, `13 oct 2026`). Numeric columns get `.num` (right-aligned, tabular figures).
- Show `—` for missing data, never `0`, `NaN`, `null` or an empty cell — a 0 % cost or 0 % return is a real (and misleading) value.

### Layout & responsiveness
- Mobile first: check at 390px. Tables become cards under 760px via `td[data-label]` — every new `<td>` needs a `data-label`.
- Grid/flex children that contain text or SVG need `min-width: 0` (or `minmax(0, 1fr)` tracks), otherwise long fund names push the page wider than the viewport. No horizontal page scroll, ever.
- Content max width 1180px, 16px side gutter. Touch targets ≥ 36px tall on mobile.
- Long fund names: let them wrap in tables/cards; ellipsize only where space is fixed (bar labels) and then add a `title` with the full name.

### Accessibility
- Semantic elements first (`button` for actions, `a` for navigation, `table` for tabular data, `label` for inputs). Icon-only or ambiguous controls need `aria-label`.
- Keep the visible focus ring (`:focus-visible` outline with `--accent`). Toggle states via `aria-pressed` / `aria-selected` / `aria-expanded`, and style off those attributes so state and semantics can't diverge.
- Text contrast ≥ 4.5:1 in both themes; `--text-2` is the lightest allowed for body text.
- Errors use `role="alert"` and say what to do next ("El archivo no tiene la columna «Valor de mercado». Exporta de nuevo desde…").

### Charts (portfolio)
- Follow the `dataviz` skill when adding or changing a chart. House rules: one y-axis only; single-series charts use `--series-1` and need no legend (the title names it); every chart has a hover tooltip; labels/values in text tokens, not series color; no 3D, no pie with > 5 slices (use `BarList`).
- Prefer a stat tile (`Kpi`) over a chart when there's one number to show.

### Privacy & trust (non-negotiable)
- Portfolio data stays in the browser: no analytics, fonts, CDNs, error trackers or `fetch` calls that could carry holdings. If a feature would need a server, stop and ask the user.
- Keep the privacy note visible near the importer and the "Borrar mis datos" action reachable.
- Never seed screenshots, fixtures or commits with the real CSVs in `csv de ejemplo/` (gitignored personal data). Use `assets/demo-portfolio.json`.
- Show data provenance: the catalog must keep crediting the community spreadsheet and showing when data was last updated. Investment info is orientative — keep the "no constituye asesoramiento" footer.

### Interaction details
- Filters live in one row above results and show a live result count; offer a way back when results are empty (e.g. "Quitar filtros").
- Destructive actions (`Borrar mis datos`, `Quitar`) need confirmation or an undo.
- Prefer progressive disclosure (expand lots, tooltips for cost breakdowns) over showing every spreadsheet column at once — the spreadsheet already exists; Invertario's value is being easier to scan.

## UX review mode

When asked to review/audit the design, run the screenshots first, then report findings grouped by severity (**Bloqueante / Importante / Mejora**). For each: what's wrong (with screenshot name or `file:line`), why it matters to an investor using the site, and the concrete fix. End with a short prioritized list. Don't change code in review mode unless asked.
