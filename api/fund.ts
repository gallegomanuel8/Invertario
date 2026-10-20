import { handle } from './_ft';

// GET /api/fund?isin=XX0000000000 → FundInfo (see ./_ft.ts). Receives only the ISIN.
export function GET(request: Request) {
  return handle(new URL(request.url));
}
