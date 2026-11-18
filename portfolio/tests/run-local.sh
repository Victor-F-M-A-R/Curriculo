#!/usr/bin/env bash
# Use fresh databases. Pre-build the three compiled web clients first.
# PostgreSQL is required: Rastro must run instead of silently skipping its browser checks.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
: "${RASTRO_DATABASE_URL:?Defina RASTRO_DATABASE_URL para um PostgreSQL descartável e exclusivo dos testes.}"
export OPENBLAS_NUM_THREADS="${OPENBLAS_NUM_THREADS:-1}" OMP_NUM_THREADS="${OMP_NUM_THREADS:-1}" MKL_NUM_THREADS="${MKL_NUM_THREADS:-1}"
capture_dir=""
if [[ $# -gt 0 ]]; then
  if [[ $# -ne 2 || $1 != --capture-only || -z ${2:-} ]]; then
    echo "Uso para gravar os quatro produtos: RASTRO_DATABASE_URL=... run-local.sh --capture-only DIRETÓRIO" >&2
    exit 2
  fi
  mkdir -p "$2"
  capture_dir="$(cd "$2" && pwd)"
fi
temp="$(mktemp -d)"
pids=()
cleanup(){ for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done; wait || true; rm -rf "$temp"; }
trap cleanup EXIT
: "${PORT_DOCA:=8081}" "${PORT_LASTRO:=8082}" "${PORT_FAROL:=8083}" "${PORT_GATE:=8085}" "${PORT_RASTRO:=8084}"
export GATE_URL="http://127.0.0.1:$PORT_GATE"
export DOCA_URL="http://127.0.0.1:$PORT_DOCA" LASTRO_URL="http://127.0.0.1:$PORT_LASTRO" FAROL_URL="http://127.0.0.1:$PORT_FAROL"
export RASTRO_URL="http://127.0.0.1:$PORT_RASTRO"
ports=("$PORT_DOCA" "$PORT_LASTRO" "$PORT_FAROL" "$PORT_GATE" "$PORT_RASTRO")
checks=("$DOCA_URL/api/yard" "$LASTRO_URL/api/health" "$FAROL_URL/api/health" "$GATE_URL/api/field" "$RASTRO_URL/health")
for port in "${ports[@]}"; do
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
(cd "$root/rastro" && RASTRO_DEMO=1 exec python3 -m uvicorn app:app --port "$PORT_RASTRO" --host 127.0.0.1) >"$temp/rastro.log" 2>&1 &
pids+=("$!")
for url in "${checks[@]}"; do
  for round in {1..60}; do curl --noproxy '*' -fs "$url" >/dev/null && break; sleep 1; done
  if ! curl --noproxy '*' -fs "$url" >/dev/null; then tail -30 "$temp/"*.log; exit 1; fi
done
if [[ -n $capture_dir ]]; then
  node "$root/showcase/capture.mjs" --out "$capture_dir"
else
  cd "$root/tests"
  npm test
fi
