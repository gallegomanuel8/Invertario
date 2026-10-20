#!/usr/bin/env bash
# Builds Invertario and captures screenshots of every view (desktop + mobile, light + dark).
# Portfolio and simulator are seeded with the fictional assets/demo-*.json — never with real user CSVs.
#
# Usage: screenshots.sh [output_dir]   (default: $TMPDIR/invertario-shots)
set -euo pipefail

SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="$(cd "$SKILL_DIR/../../.." && pwd)"
OUT="${1:-${TMPDIR:-/tmp}/invertario-shots}"
PORT=4790
mkdir -p "$OUT"

find_browser() {
  local c
  for c in \
    "$HOME"/Library/Caches/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-*/chrome-headless-shell \
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
    "$(command -v chromium 2>/dev/null || true)" "$(command -v google-chrome 2>/dev/null || true)"; do
    [[ -n "$c" && -x "$c" ]] && { echo "$c"; return; }
  done
  echo "No headless Chromium found. Install one with: npx playwright install chromium-headless-shell" >&2
  exit 1
}
BROWSER="$(find_browser)"

cd "$ROOT"
npm run build --silent >/dev/null
json() { node -e 'process.stdout.write(JSON.stringify(require("fs").readFileSync(process.argv[1],"utf8")))' "$1"; }
SEED="$(json "$SKILL_DIR/assets/demo-portfolio.json")"
SIMS="$(json "$SKILL_DIR/assets/demo-sims.json")"
echo "<script>localStorage.setItem('invertario.portfolio.v1', $SEED);localStorage.setItem('invertario.sims.v1', $SIMS);location.href='/#/cartera'</script>" > dist/__seed.html

npx vite preview --port "$PORT" --strictPort >/dev/null 2>&1 &
SERVER=$!
PROFILE="$(mktemp -d)"
trap 'kill $SERVER 2>/dev/null; rm -rf "$PROFILE" dist/__seed.html' EXIT
for _ in $(seq 1 30); do curl -sf "http://localhost:$PORT/" >/dev/null && break; sleep 0.3; done

shot() { # name width height url [extra flags...]
  local name=$1 w=$2 h=$3 url=$4; shift 4
  "$BROWSER" --headless --disable-gpu --hide-scrollbars --virtual-time-budget=4000 \
    --user-data-dir="$PROFILE" --window-size="$w,$h" "$@" --screenshot="$OUT/$name.png" "$url" >/dev/null 2>&1
  echo "$OUT/$name.png"
}
DARK=(--blink-settings=preferredColorScheme=0)
B="http://localhost:$PORT"

shot seed 400 300 "$B/__seed.html" >/dev/null   # populates localStorage in the shared profile
shot catalog-desktop        1280 1400 "$B/"
shot catalog-mobile          390 1800 "$B/"
shot catalog-mobile-dark     390 1800 "$B/" "${DARK[@]}"
shot detail-desktop        1280 1000 "$B/#/?f=IE00BD0NCM55"
shot detail-mobile           390  900 "$B/#/?f=IE00BD0NCM55"
shot compare-desktop        1280 1000 "$B/#/?cmp=IE00BYX5MX67,IE0032126645,LU0474966164&vs=1"
shot simulator-desktop     1280 1900 "$B/#/simulador/demo1"
shot simulator-mobile        390 2600 "$B/#/simulador/demo1"
shot simulator-empty        1280 1000 "$B/#/simulador/none" --user-data-dir="$(mktemp -d)"
shot portfolio-desktop      1280 1800 "$B/#/cartera"
shot portfolio-desktop-dark 1280 1800 "$B/#/cartera" "${DARK[@]}"
shot portfolio-mobile        390 2600 "$B/#/cartera"
rm -f "$OUT/seed.png"
