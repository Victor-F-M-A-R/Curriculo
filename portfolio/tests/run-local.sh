#!/usr/bin/env bash
# Run in a disposable directory with fresh demo data. Pre-build the three web clients first.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
temp="$(mktemp -d)"
pids=()
cleanup(){ for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done; wait || true; rm -rf "$temp"; }
trap cleanup EXIT
: "${PORT_DOCA:=8081}" "${PORT_LASTRO:=8082}" "${PORT_FAROL:=8083}" "${PORT_GATE:=8085}"
export GATE_URL="http://127.0.0.1:$PORT_GATE"
export DOCA_URL="http://127.0.0.1:$PORT_DOCA" LASTRO_URL="http://127.0.0.1:$PORT_LASTRO" FAROL_URL="http://127.0.0.1:$PORT_FAROL"
for port in "$PORT_DOCA" "$PORT_LASTRO" "$PORT_FAROL" "$PORT_GATE"; do
  if curl -s --max-time 1 --noproxy '*' "http://127.0.0.1:$port/" -o /dev/null; then echo "Porta ocupada: $port" >&2; exit 2; fi
done
PORT="$PORT_DOCA" JDBC_URL="${E2E_JDBC_URL:-jdbc:h2:mem:e2e;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE}" DB_USER="${TEST_DB_USER:-sa}" DB_PASSWORD="${TEST_DB_PASSWORD:-}" \
 SPRING_WEB_RESOURCES_STATIC_LOCATIONS="file:$root/doca-norte/web/dist/doca/browser/" java -jar "$root/doca-norte/server/target/yard-api-1.0.0.jar" >"$temp/doca.log" 2>&1 &
pids+=("$!")
YARD_ORIGIN="$DOCA_URL" PORT="$PORT_GATE" java -jar "$root/doca-norte/portaria/target/gate-reader-1.0.0.jar" >"$temp/portaria.log" 2>&1 &
pids+=("$!")
mkdir -p "$temp/wwwroot"
cp -R "$root/lastro/web/dist/." "$temp/wwwroot"
cp "$root/lastro/server/wwwroot/audit.css" "$temp/wwwroot/"
BOOK_ENGINE="${TEST_BOOK_ENGINE:-sqlite}" BOOK_CONNECTION="${TEST_BOOK_CONNECTION:-Data Source=$temp/book.db}" dotnet "$root/lastro/server/bin/Release/net10.0/Lastro.dll" --webroot "$temp/wwwroot" --urls "$LASTRO_URL" >"$temp/lastro.log" 2>&1 &
pids+=("$!")
(cd "$root/farol/service" && FAROL_DB="$temp/farol.db" exec python3 -m uvicorn app:app --port "$PORT_FAROL" --host 127.0.0.1) >"$temp/farol.log" 2>&1 &
pids+=("$!")
for url in "$DOCA_URL/api/yard" "$LASTRO_URL/api/health" "$FAROL_URL/api/health" "$GATE_URL/api/field"; do
  for round in {1..60}; do curl --noproxy '*' -fs "$url" >/dev/null && break; sleep 1; done
  if ! curl --noproxy '*' -fs "$url" >/dev/null; then tail -30 "$temp/"*.log; exit 1; fi
done
cd "$root/tests"
npm test
