"""Restart/outage checks for the disposable CI Compose project, after compose_verify.

Host dependencies: Python standard library and Docker Compose. HTTP probes run
inside existing application containers; session cookies travel only through
captured stdin/stdout, never command arguments, files or logs. All new records
are synthetic. This script never removes a project, container volume or record.
It accepts only the workflow's explicit portfolio-ci-<run>-<attempt> project.
"""

import html
import copy
import http.cookiejar
import json
import os
from pathlib import Path
import re
import sqlite3
import subprocess
import sys
import time
import math
import statistics
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from urllib.error import HTTPError, URLError
from urllib.request import HTTPCookieProcessor, ProxyHandler, Request, build_opener
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
COMPOSE = ["docker", "compose", "-f", "compose.yaml", "-f", "compose.automation.yaml", "--profile", "automation"]
SERVICES = ("postgres", "doca", "portaria", "lastro", "farol", "rastro", "inbox", "n8n")
ORIGINS = {"doca": "http://doca:8081", "portaria": "http://portaria:8085",
           "lastro": "http://lastro:8082", "farol": "http://farol:8083",
           "rastro": "http://rastro:8080", "inbox": "http://inbox:8084", "n8n": "http://n8n:5678"}
HEALTH = {"doca": "/api/yard", "portaria": "/api/field", "lastro": "/api/health",
          "farol": "/api/health", "rastro": "/health", "inbox": "/health",
          "n8n": "/healthz/readiness"}


def check(condition, message):
    if not condition:
        raise AssertionError(message)


class Session:
    """Cookie state belongs exclusively to this synthetic test, across probes."""
    def __init__(self, state):
        self.state = state
        self.jar = http.cookiejar.CookieJar()
        for cookie in state.get("_cookies", []):
            self.jar.set_cookie(http.cookiejar.Cookie(**cookie))
        self.browser = build_opener(ProxyHandler({}), HTTPCookieProcessor(self.jar))

    def save(self):
        fields = ("version", "name", "value", "port", "port_specified", "domain",
                  "domain_specified", "domain_initial_dot", "path", "path_specified",
                  "secure", "expires", "discard", "comment", "comment_url", "rfc2109")
        self.state["_cookies"] = [dict({key: getattr(cookie, key) for key in fields}, rest=cookie._rest)
                                  for cookie in self.jar]

    def request(self, service, path, body=None, headers=None, timeout=12):
        data = None if body is None else json.dumps(body).encode()
        req = Request(ORIGINS[service] + path, data=data,
                      headers={"Content-Type": "application/json", **(headers or {})})
        started = time.monotonic()
        try:
            response = self.browser.open(req, timeout=timeout)
        except HTTPError as error:
            response = error
        with response:
            raw = response.read()
            try:
                payload = json.loads(raw) if raw else None
            except (ValueError, UnicodeDecodeError):
                payload = raw.decode("utf-8", errors="replace")
            elapsed = time.monotonic() - started
            self.save()
            return response.status, payload, elapsed


def expect(session, service, path, status=200, **kwargs):
    actual, result, elapsed = session.request(service, path, **kwargs)
    check(actual == status, f"{service} {path}: esperado HTTP {status}, recebido {actual}")
    return result


def doca_session(session):
    current = expect(session, "doca", "/api/session")
    check(current.get("canWrite") is True, "Doca deve estar no modo de demonstração local")
    session.state["doca_csrf"] = {current["csrfHeader"]: current["csrf"]}


def book_headers(state):
    return {"X-Lastro-Client": "desk", "X-Lastro-Workspace": state["workspace"]}


def seed_products(session):
    state = session.state
    doca_session(session)
    yard = expect(session, "doca", "/api/yard")
    dock = next(row for row in yard["docks"] if row["id"] == "D1")
    check(dock["status"] == "free", "Execute após compose_verify em projeto descartável com D1 livre")
    state["doca_key"] = str(uuid4())
    state["doca_command"] = {"action": "book", "carrier": "Ensaio CI " + state["tag"],
                             "expectedVersion": dock["version"]}
    state["doca_result"] = expect(session, "doca", "/api/docks/D1/moves",
        body=state["doca_command"], headers={**state["doca_csrf"], "Idempotency-Key": state["doca_key"]})
    check(state["doca_result"]["status"] == "booked", "Reserva sintética não foi persistida")

    # This browser has no Lastro cookie from compose_verify: create its own desk.
    expect(session, "lastro", "/api/session/demo", 204, body={}, headers={"X-Lastro-Client": "desk"})
    desk = expect(session, "lastro", "/api/session")
    check(desk["logged"] and desk.get("workspace"), "Sessão Lastro não foi criada")
    state["workspace"] = desk["workspace"]
    state["review_note"] = "Conferência sintética de reinício " + state["tag"]
    expect(session, "lastro", "/api/book/REP-1043/review", 204,
           body={"note": state["review_note"]}, headers=book_headers(state))
    state["lastro_before"] = expect(session, "lastro", "/api/book", headers=book_headers(state))

    question = "Onde fica o cabo HDMI reserva?"
    answer = expect(session, "farol", "/api/ask", body={"query": question}, headers={"X-Farol-Client": "desk"})
    check(answer["state"] == "answered" and "armário A2" in answer["answer"], "Consulta sintética Farol falhou")
    state["farol_run"] = answer["id"]
    state["farol_answer"] = answer["answer"]
    check(Session({}).request("farol", "/api/runs/" + answer["id"])[0] == 404, "Consulta vazou para outra sessão")


def seed_rastro(state):
    # Ingestion is deliberately disabled for external callers in this Compose.
    # Provision a new synthetic vehicle through the same transactional repository,
    # then verify its data through the real HTTP API before/after restart.
    import psycopg
    import repository
    from decimal import Decimal
    from psycopg.rows import dict_row

    vehicle = state["vehicle"]
    origin = datetime.now(timezone.utc) - timedelta(minutes=2)
    records = []
    with psycopg.connect(os.environ["RASTRO_DATABASE_URL"], row_factory=dict_row,
                         connect_timeout=5, options="-c statement_timeout=8000") as db:
        db.execute("insert into rastro.vehicles(vehicle_id,name,route) values(%s,%s,%s)",
                   (vehicle, "Ensaio CI", "Percurso sintético de reinício"))
        for sequence, offset in ((1, 0), (3, 60), (2, 30)):
            event = {"vehicle_id": vehicle, "event_id": uuid4(), "observed_at": origin + timedelta(seconds=offset),
                     "device_seq": sequence, "latitude": Decimal("-23.500100"),
                     "longitude": Decimal("-46.500200"), "speed_kmh": 20 + sequence}
            records.append({"id": str(event["event_id"]), "outcome": repository.ingest(db, event)})
    check([row["outcome"] for row in records] == ["advanced", "advanced", "late"], "Ingestão sintética Rastro falhou")
    state["rastro_ids"] = [records[1]["id"], records[2]["id"], records[0]["id"]]


def rastro_snapshot(session):
    state = session.state
    fleet = expect(session, "rastro", "/api/fleet")
    row = next(item for item in fleet["vehicles"] if item["vehicle_id"] == state["vehicle"])
    history = expect(session, "rastro", "/api/vehicles/" + state["vehicle"] + "/events")
    check([item["event_id"] for item in history["events"]] == state["rastro_ids"], "Eventos Rastro foram perdidos/reordenados")
    check(row["unique_count"] == 3 and row["late_count"] == 1 and row["event_id"] == state["rastro_ids"][0],
          "Estado atual ou contadores Rastro incorretos")
    return {"vehicle": row, "events": history["events"]}


def verify_restart(session, service):
    state = session.state
    if service == "doca":
        # HTTP sessions are allowed to be volatile; business commands are not.
        doca_session(session)
        replay = expect(session, "doca", "/api/docks/D1/moves", body=state["doca_command"],
                        headers={**state["doca_csrf"], "Idempotency-Key": state["doca_key"]})
        check(replay == state["doca_result"], "Reenvio Doca após reinício não preservou o resultado")
        yard = expect(session, "doca", "/api/yard")
        moves = [row for row in yard["moves"] if row["carrier"] == state["doca_command"]["carrier"]]
        check(len(moves) == 1, "Reenvio Doca duplicou a movimentação")
    elif service == "lastro":
        desk = expect(session, "lastro", "/api/session")
        check(desk["logged"] and desk["workspace"] == state["workspace"], "Cookie/chaves/mesa Lastro não sobreviveram ao reinício")
        check(expect(session, "lastro", "/api/book", headers=book_headers(state)) == state["lastro_before"],
              "Livro Lastro mudou após reinício")
        audit = expect(session, "lastro", "/api/book/events", headers=book_headers(state))
        check(sum(row["detail"] == state["review_note"] for row in audit) == 1, "Revisão Lastro não foi preservada uma única vez")
        rendered = expect(session, "lastro", "/audit?referencia=REP-1043")
        check(state["review_note"] in html.unescape(rendered), "Auditoria Blazor perdeu a revisão após reinício")
    elif service == "farol":
        answer = expect(session, "farol", "/api/runs/" + state["farol_run"])
        check(answer["answer"] == state["farol_answer"], "Consulta/sessão Farol não sobreviveu ao reinício")
        check(Session({}).request("farol", "/api/runs/" + state["farol_run"])[0] == 404,
              "Consulta Farol perdeu isolamento após reinício")
    elif service == "rastro":
        check(rastro_snapshot(session) == state["rastro_before"], "Leituras Rastro não sobreviveram ao reinício")


def database_outage(session):
    state = session.state
    probes = [("doca", "/api/yard", None, {}), ("lastro", "/api/book", None, book_headers(state)),
              ("rastro", "/api/fleet", None, {}),
              ("doca", "/api/docks/D1/moves", {"action": "start", "carrier": "", "expectedVersion": state["doca_result"]["version"]},
               {**state["doca_csrf"], "Idempotency-Key": str(uuid4())}),
              ("lastro", "/api/book/REP-1045/review", {"note": "Tentativa sintética durante indisponibilidade"}, book_headers(state)),
              ("rastro", "/api/demo/scenario", {}, {"X-Rastro-Client": "monitor"})]
    times = []
    for service, path, body, headers in probes:
        status, _, elapsed = session.request(service, path, body=body, headers=headers, timeout=12)
        check(status == 503, f"{service}: indisponibilidade deveria retornar 503, recebeu {status}")
        check(elapsed < 12.5, f"{service}: resposta de indisponibilidade excedeu 12 segundos")
        times.append(round(elapsed, 3))
    state["outage_seconds"] = times
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        status, board, _ = session.request("portaria", "/api/field", timeout=3)
        check(status == 200, "Portaria deve conservar a última leitura por até 120 segundos")
        check(board["docks"] == state["portaria_before"]["docks"], "Portaria alterou o quadro durante a interrupção")
        if board.get("stale") is True:
            return
        time.sleep(.5)
    raise AssertionError("Portaria não identificou como antiga a leitura com mais de 12 segundos")


def warm_portaria(session):
    state = session.state
    deadline = time.monotonic() + 25
    while time.monotonic() < deadline:
        board = expect(session, "portaria", "/api/field")
        dock = next(row for row in board["docks"] if row["id"] == "D1")
        if not board["stale"] and dock["carrier"] == state["doca_command"]["carrier"]:
            state["portaria_before"] = board
            return
        time.sleep(.5)
    raise AssertionError("Portaria não recebeu uma leitura recente antes da interrupção")


def burst(state):
    """Eight independent cookie jars, ten rounds, four real read endpoints.

    Timings describe this CI sample only, not a production throughput/SLA claim.
    """
    def reader(_):
        session = Session(copy.deepcopy(state))
        samples = []
        routes = (("doca", "/api/yard"), ("lastro", "/api/book"),
                  ("farol", "/api/runs/" + state["farol_run"]), ("rastro", "/api/fleet"))
        for _ in range(10):
            for service, path in routes:
                status, body, seconds = session.request(service, path,
                    headers=book_headers(state) if service == "lastro" else None, timeout=12)
                check(status == 200, f"Rajada {service}: esperado 200, recebido {status}")
                if service == "doca":
                    check(len(body.get("docks", [])) == 6, "Rajada Doca: quadro incompleto")
                elif service == "lastro":
                    check(body == state["lastro_before"], "Rajada Lastro: livro/sessão divergente")
                elif service == "farol":
                    check(body.get("id") == state["farol_run"] and body.get("answer") == state["farol_answer"],
                          "Rajada Farol: consulta/sessão divergente")
                else:
                    vehicle = next((item for item in body.get("vehicles", []) if item["vehicle_id"] == state["vehicle"]), None)
                    check(vehicle and vehicle["event_id"] == state["rastro_ids"][0], "Rajada Rastro: leitura incorreta")
                samples.append((service, seconds * 1000))
        return samples

    measurements = {service: [] for service in ("doca", "lastro", "farol", "rastro")}
    with ThreadPoolExecutor(max_workers=8) as pool:
        for results in pool.map(reader, range(8)):
            for service, milliseconds in results:
                measurements[service].append(milliseconds)
    state["burst"] = {}
    for service, values in measurements.items():
        values.sort()
        check(len(values) == 80, "Contagem de leituras da rajada incorreta")
        state["burst"][service] = {"count": len(values), "p50_ms": round(statistics.median(values), 2),
            "p95_ms": round(values[math.ceil(.95 * len(values))-1], 2), "max_ms": round(values[-1], 2)}


def queue_review(session):
    state = session.state
    result = expect(session, "farol", "/api/ask", body={"query": "Qual é o preço mensal da WAN Cedro?"},
                    headers={"X-Farol-Client": "desk"})
    check(result["state"] == "abstained", "Pergunta sintética sem evidência deveria ser recusada")
    state["queued_run"] = result["id"]
    review = expect(session, "farol", "/api/runs/" + result["id"] + "/review", body={}, headers={"X-Farol-Client": "desk"})
    check(review["delivery"] in {"queued", "sending"}, "Evento não permaneceu pendente com n8n parado")
    with sqlite3.connect(Path(os.environ["FAROL_DB"]).resolve().as_uri() + "?mode=ro", uri=True) as db:
        rows = db.execute("select id from reviews where run_id=?", (result["id"],)).fetchall()
    check(len(rows) == 1, "A fila deve conter um único evento para a revisão")
    state["queued_event"] = rows[0][0]


def replay_review(session):
    state = session.state
    envelope = {"event_id": state["queued_event"], "run_id": state["queued_run"], "kind": "review.requested"}
    check(os.environ["REVIEW_WEBHOOK_URL"] == ORIGINS["n8n"] + "/webhook/farol-review", "Workflow deve ser o local do Compose")
    for _ in range(2):
        result = expect(session, "n8n", "/webhook/farol-review", body=envelope,
                        headers={"X-Farol-Token": os.environ["REVIEW_WEBHOOK_TOKEN"]}, timeout=15)
        check(result == {"event_id": state["queued_event"]}, "Reenvio não confirmou o mesmo evento")


def inside(stage, state):
    session = Session(state)
    if stage == "seed": seed_products(session)
    elif stage == "seed-rastro": seed_rastro(state)
    elif stage == "snapshot-rastro": state["rastro_before"] = rastro_snapshot(session)
    elif stage == "verify-restart": verify_restart(session, state["service"])
    elif stage == "warm-portaria": warm_portaria(session)
    elif stage == "burst": burst(state)
    elif stage == "database-outage": database_outage(session)
    elif stage == "queue-review": queue_review(session)
    elif stage == "replay-review": replay_review(session)
    elif stage == "delivery":
        result = expect(session, "farol", "/api/runs/" + state["queued_run"])
        state["delivery"] = result["delivery"]
    elif stage == "health":
        try: state["ready"] = session.request(state["service"], HEALTH[state["service"]], timeout=2)[0] == 200
        except (URLError, TimeoutError, ConnectionError): state["ready"] = False
    else: raise ValueError("Etapa desconhecida")
    session.save()
    return state


def command(arguments, *, input=None, timeout=120):
    result = subprocess.run(arguments, cwd=ROOT, input=input, text=True, capture_output=True, timeout=timeout)
    if result.returncode:
        # Do not relay stderr/stdout: a failing child could include session state.
        raise RuntimeError("Comando da verificação falhou; consulte o diagnóstico dos serviços no CI.")
    return result.stdout.strip()


def worker(stage, state, *, service="farol", timeout=120):
    source = Path(__file__).read_text(encoding="utf-8")
    payload = "STATE = " + repr(state) + "\n" + source
    output = command([*COMPOSE, "exec", "-T", service, "python", "-", "--inside", stage], input=payload, timeout=timeout)
    response = json.loads(output)
    if "error" in response:
        raise AssertionError(stage + ": " + response["error"])
    return response["state"]


def ready(service, state, *, deadline=None, via="farol"):
    deadline = deadline or time.monotonic() + 120
    state["service"] = service
    while time.monotonic() < deadline:
        try:
            state = worker("health", state, service=via, timeout=min(10, max(1, deadline-time.monotonic())))
            if state["ready"]: return state
        except (RuntimeError, subprocess.TimeoutExpired, json.JSONDecodeError):
            pass  # An exec may race the container's process startup.
        time.sleep(.5)
    raise AssertionError(service + " não voltou a responder no prazo")


def guard_project():
    project = os.environ.get("COMPOSE_PROJECT_NAME", "")
    check(re.fullmatch(r"portfolio-ci-[0-9]+-[0-9]+", project), "Use somente o projeto descartável explícito do workflow portfolio-ci-<run>-<attempt>")
    for service in SERVICES:
        container = command([*COMPOSE, "ps", "-q", service])
        check(container and "\n" not in container, service + ": era esperado um único container em execução")
        label = command(["docker", "inspect", "--format", '{{index .Config.Labels "com.docker.compose.project"}}', container])
        check(label == project, "Container fora do projeto descartável esperado")
    return project


def inbox_rows(project):
    container = command([*COMPOSE, "ps", "-q", "inbox"])
    mounts = json.loads(command(["docker", "inspect", "--format", "{{json .Mounts}}", container]))
    volumes = [mount["Name"] for mount in mounts if mount["Type"] == "volume" and mount["Destination"] == "/data"]
    check(len(volumes) == 1 and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]*", volumes[0]), "Volume Inbox não identificado")
    label = command(["docker", "volume", "inspect", "--format", '{{index .Labels "com.docker.compose.project"}}', volumes[0]])
    check(label == project, "Volume Inbox não pertence ao projeto descartável")
    image = command([*COMPOSE, "images", "-q", "farol"])
    check(image and "\n" not in image, "Imagem Farol não identificada")
    query = "import json,sqlite3; db=sqlite3.connect('file:/inbox/inbox.db?mode=ro',uri=True); print(json.dumps(db.execute('select event_id,run_id from review_inbox order by event_id').fetchall()))"
    return json.loads(command(["docker", "run", "--rm", "--network", "none", "--read-only", "--cap-drop", "ALL",
        "--security-opt", "no-new-privileges", "--memory", "256m", "--cpus", "1", "--pids-limit", "64",
        "--user", "10001:10001", "--mount", f"type=volume,src={volumes[0]},dst=/inbox,readonly",
        "--entrypoint", "python", image, "-c", query]))


def host():
    project = guard_project()
    state = {"tag": uuid4().hex[:10], "vehicle": "QA-" + uuid4().hex[:12].upper()}
    touched = False
    try:
        state = worker("seed", state)
        state = worker("seed-rastro", state, service="rastro")
        state = worker("snapshot-rastro", state)
        for service in ("doca", "lastro", "farol", "rastro"):
            touched = True
            command([*COMPOSE, "restart", "--no-deps", "-t", "3", service])
            state = ready(service, state, via="rastro" if service == "farol" else "farol")
            state["service"] = service
            state = worker("verify-restart", state)
        print("PASS · reinícios preservaram comando/replay Doca, cookie/mesa/revisão Lastro, consulta Farol e leituras Rastro")
        state = worker("burst", state, timeout=150)
        print("PASS · rajada de 320 leituras válidas, oito clientes, sem 5xx; tempos desta execução CI (não SLA): "
              + json.dumps(state["burst"], ensure_ascii=False))

        state = worker("warm-portaria", state)
        try:
            command([*COMPOSE, "stop", "-t", "3", "postgres"])
            state = worker("database-outage", state, timeout=110)
        finally:
            command([*COMPOSE, "start", "postgres"])
        for service in ("doca", "lastro", "rastro"):
            state = ready(service, state)
            state["service"] = service
            state = worker("verify-restart", state)
        state = worker("warm-portaria", state)
        print("PASS · PostgreSQL interrompido: seis leituras/escritas retornaram 503 em até 12s; Portaria marcou leitura antiga e recuperou")

        before = inbox_rows(project)
        started = time.monotonic()
        deadline = started + 180
        try:
            command([*COMPOSE, "stop", "-t", "3", "n8n"], timeout=30)
            state = worker("queue-review", state, timeout=20)
            # Durable leases expire after 45s; failures back off 2,4,8,16,32s.
            # Restart promptly, preserving event IDs and the six-attempt budget.
            command([*COMPOSE, "restart", "--no-deps", "-t", "3", "farol", "inbox"], timeout=30)
        finally:
            command([*COMPOSE, "start", "n8n"], timeout=30)
        state = ready("farol", state, deadline=deadline, via="rastro")
        state = ready("inbox", state, deadline=deadline)
        state = ready("n8n", state, deadline=deadline)
        while time.monotonic() < deadline:
            state = worker("delivery", state, timeout=min(15, max(1, deadline-time.monotonic())))
            check(state["delivery"] != "failed", "A fila esgotou tentativas antes da recuperação do workflow")
            if state["delivery"] == "delivered": break
            time.sleep(.5)
        else:
            raise AssertionError("Entrega não foi confirmada em até 180 segundos")
        state = worker("replay-review", state, timeout=40)
        after = inbox_rows(project)
        expected = sorted(before + [[state["queued_event"], state["queued_run"]]])
        check(after == expected, "Inbox perdeu dados anteriores ou o reenvio duplicou a nova revisão")
        elapsed = round(time.monotonic() - started, 2)
        check(elapsed <= 180, "Entrega e confirmação de unicidade excederam 180 segundos")
        print(f"PASS · n8n interrompido e Farol/Inbox reiniciados: entrega em {elapsed}s, um novo evento persistido após dois reenvios")
    finally:
        if touched:
            failures = []
            # Restore every originally running service even if an assertion or
            # restart failed. No down/rm/prune/volume deletion exists in this script.
            for service in SERVICES:
                try: command([*COMPOSE, "start", service], timeout=45)
                except (RuntimeError, subprocess.TimeoutExpired): failures.append(service)
            restoration_deadline = time.monotonic() + 90
            for service in HEALTH:
                try: state = ready(service, state, deadline=restoration_deadline, via="rastro" if service == "farol" else "farol")
                except (AssertionError, RuntimeError, subprocess.TimeoutExpired):
                    if service not in failures: failures.append(service)
            if failures:
                raise RuntimeError("Não foi possível restabelecer: " + ", ".join(failures))


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "--inside":
        try:
            print(json.dumps({"state": inside(sys.argv[2], STATE)}, ensure_ascii=False))
        except AssertionError as error:
            print(json.dumps({"error": str(error)}, ensure_ascii=False))
        except Exception as error:
            # Exception details may contain request headers; publish only a type.
            print(json.dumps({"error": type(error).__name__}))
    elif not sys.argv[1:]:
        host()
    else:
        raise SystemExit("Uso: python tests/resilience_verify.py")
