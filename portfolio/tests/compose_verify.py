"""Verify fresh, disposable Compose services, including real n8n delivery.

Run from the host after starting compose.yaml + compose.automation.yaml.
Only the Python standard library is required. HTTP requests run inside Farol;
no additional host ports, credentials, or Docker socket mounts are needed.
This script changes synthetic demo records. Use a dedicated Compose project.
"""

import html
import http.cookiejar
import json
import os
from pathlib import Path
import re
import sqlite3
import subprocess
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.request import HTTPCookieProcessor, ProxyHandler, Request, build_opener
from uuid import uuid4


ROOT = Path(__file__).resolve().parents[1]
COMPOSE = ["docker", "compose", "-f", "compose.yaml", "-f", "compose.automation.yaml", "--profile", "automation"]


def check(condition, message):
    if not condition:
        raise AssertionError(message)


def client():
    return build_opener(ProxyHandler({}), HTTPCookieProcessor(http.cookiejar.CookieJar()))


def request(browser, url, body=None, headers=None, timeout=8):
    data = None if body is None else json.dumps(body).encode()
    request_headers = {"Content-Type": "application/json", **(headers or {})}
    req = Request(url, data=data, headers=request_headers)
    try:
        response = browser.open(req, timeout=timeout)
    except HTTPError as error:
        response = error
    with response:
        raw = response.read()
        try:
            payload = json.loads(raw) if raw else None
        except (ValueError, UnicodeDecodeError):
            payload = raw.decode("utf-8", errors="replace")
        return response.status, payload


def wait_until_ready(browser):
    pending = {
        "Doca": "http://doca:8081/api/yard",
        "Portaria": "http://portaria:8085/api/field",
        "Lastro": "http://lastro:8082/api/health",
        "Farol": "http://127.0.0.1:8083/api/health",
        "Rastro": "http://rastro:8080/health",
        "Inbox": "http://inbox:8084/health",
        "n8n": "http://n8n:5678/healthz/readiness",
    }
    deadline = time.monotonic() + 180
    while pending and time.monotonic() < deadline:
        for name, url in list(pending.items()):
            try:
                if request(browser, url, timeout=2)[0] == 200:
                    del pending[name]
            except (URLError, TimeoutError, ConnectionError):
                pass
        if pending:
            time.sleep(1)
    check(not pending, "Serviços não ficaram disponíveis: " + ", ".join(pending))


def products(browser):
    for origin in ("http://doca:8081", "http://lastro:8082", "http://127.0.0.1:8083", "http://rastro:8080"):
        status, document = request(browser, origin + "/")
        check(status == 200 and isinstance(document, str) and "<html" in document.lower(),
              "A imagem não está servindo a interface compilada: " + origin)

    yard_url = "http://doca:8081"
    status, session = request(browser, yard_url + "/api/session")
    check(status == 200 and session["canWrite"], "Sessão local do Doca indisponível")
    status, yard = request(browser, yard_url + "/api/yard")
    check(status == 200 and len(yard["docks"]) == 6, "Pátio inicial incompleto")
    dock = next(d for d in yard["docks"] if d["id"] == "D1")
    check(dock["status"] == "free", "Use um pátio descartável com D1 livre")
    for action, state in (("book", "booked"), ("start", "servicing"), ("release", "free")):
        status, dock = request(browser, yard_url + "/api/docks/D1/moves", {
            "action": action, "carrier": "Transporte CI" if action == "book" else "",
            "expectedVersion": dock["version"],
        }, {session["csrfHeader"]: session["csrf"], "Idempotency-Key": str(uuid4())})
        check(status == 200 and dock["status"] == state, "Transição do Doca falhou: " + action)

    lastro = "http://lastro:8082"
    header = {"X-Lastro-Client": "desk"}
    check(request(browser, lastro + "/api/session/demo", {}, header)[0] == 204, "Mesa Lastro indisponível")
    csv = "referencia;data;recebido\nREP-1047;2026-11-16;710,00\nREP-1048;2026-11-16;1950,00"
    for replay in (False, True):
        status, result = request(browser, lastro + "/api/book/import", {"csv": csv}, header)
        check(status == 200 and result == {"count": 2, "replay": replay}, "Importação/reenvio do Lastro falhou")
    status, book = request(browser, lastro + "/api/book")
    item = next(row for row in book if row["reference"] == "REP-1048")
    check(status == 200 and item["delta"] == -1750, "A diferença financeira não foi preservada")
    note = "Conferência sintética do fluxo Compose."
    check(request(browser, lastro + "/api/book/REP-1048/review", {"note": note}, header)[0] == 204,
          "Revisão do Lastro falhou")
    status, audit = request(browser, lastro + "/audit?referencia=REP-1048")
    check(status == 200 and note in html.unescape(audit), "A auditoria Blazor não exibiu a revisão")

    rastro = "http://rastro:8080"
    for outcomes in (["advanced", "replay", "late"], ["replay"] * 3):
        status, result = request(browser, rastro + "/api/demo/scenario", {}, {"X-Rastro-Client": "monitor"})
        check(status == 200 and [r["outcome"] for r in result["receipts"]] == outcomes,
              "Ordenação/reenvio do Rastro falhou; use uma base de demonstração nova")


def automation(browser):
    farol = "http://127.0.0.1:8083"
    hook = os.environ["REVIEW_WEBHOOK_URL"]
    token = os.environ["REVIEW_WEBHOOK_TOKEN"]
    check(hook == "http://n8n:5678/webhook/farol-review", "Use o workflow Compose local")
    envelope = {"event_id": uuid4().hex, "run_id": uuid4().hex, "kind": "review.requested"}

    # Readiness may precede activation of the imported production webhook.
    deadline = time.monotonic() + 45
    while True:
        status, _ = request(browser, hook, envelope)
        if status in (401, 403):
            break
        check(status == 404 and time.monotonic() < deadline, "O webhook não protege a entrada ou não foi ativado")
        time.sleep(1)
    check(request(browser, hook, envelope, {"X-Farol-Token": "invalid-ci-token"})[0] in (401, 403),
          "n8n aceitou credencial inválida")
    for headers in ({}, {"X-Inbox-Token": "invalid-ci-token"}):
        check(request(browser, "http://inbox:8084/events", envelope, headers)[0] == 401,
              "Inbox aceitou evento sem a credencial correta")

    status, answer = request(browser, farol + "/api/ask", {
        "query": "Qual é o preço mensal do contrato da WAN Cedro?",
    }, {"X-Farol-Client": "desk"})
    check(status == 200 and answer["state"] == "abstained", "Farol deveria recusar a pergunta sem evidência")
    run_id = answer["id"]
    route = farol + "/api/runs/" + run_id
    check(request(client(), route)[0] == 404, "Uma segunda sessão acessou a consulta")
    check(request(browser, route + "/review", {})[0] == 403, "Revisão aceitou chamada sem cabeçalho do cliente")
    status, review = request(browser, route + "/review", {}, {"X-Farol-Client": "desk"})
    check(status == 200 and review["delivery"] in ("queued", "sending", "delivered"), "Revisão não entrou na fila")
    deadline = time.monotonic() + 75
    while time.monotonic() < deadline:
        status, result = request(browser, route)
        check(status == 200, "Consulta deixou de estar disponível durante a entrega")
        if result["delivery"] == "delivered":
            break
        check(result["delivery"] != "failed", "A entrega FastAPI → n8n → Inbox falhou")
        time.sleep(.5)
    else:
        raise AssertionError("A entrega não foi confirmada no prazo")

    database = Path(os.environ["FAROL_DB"]).resolve().as_uri() + "?mode=ro"
    with sqlite3.connect(database, uri=True) as db:
        records = db.execute("SELECT id FROM reviews WHERE run_id=? AND delivery='delivered'", (run_id,)).fetchall()
    check(len(records) == 1, "A fila deve ter uma única revisão entregue")
    event_id = records[0][0]
    envelope.update(event_id=event_id, run_id=run_id)
    for _ in range(2):
        status, result = request(browser, hook, envelope, {"X-Farol-Token": token}, timeout=15)
        check(status == 200 and result == {"event_id": event_id}, "Reenvio pelo n8n não confirmou o mesmo evento")
    return {"event_id": event_id, "run_id": run_id}


def command(arguments, **kwargs):
    result = subprocess.run(arguments, cwd=ROOT, text=True, capture_output=True, timeout=420, **kwargs)
    if result.returncode:
        # Never print container environments or authentication values.
        raise RuntimeError("Comando de verificação falhou:\n" + result.stderr[-6000:])
    return result.stdout.strip()


def host():
    source = Path(__file__).read_text(encoding="utf-8")
    receipt = json.loads(command([*COMPOSE, "exec", "-T", "farol", "python", "-", "--inside"], input=source))
    inbox = command([*COMPOSE, "ps", "-q", "inbox"])
    check(bool(inbox) and "\n" not in inbox, "Era esperado um único container Inbox")
    mounts = json.loads(command(["docker", "inspect", "--format", "{{json .Mounts}}", inbox]))
    volumes = [m["Name"] for m in mounts if m["Type"] == "volume" and m["Destination"] == "/data"]
    check(len(volumes) == 1 and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]*", volumes[0]), "Volume Inbox não identificado")
    image = command([*COMPOSE, "images", "-q", "farol"])
    check(bool(image) and "\n" not in image, "Imagem Farol não identificada")
    inspection = """
import sqlite3, sys
with sqlite3.connect('file:/inbox/inbox.db?mode=ro', uri=True) as db:
    rows = db.execute('SELECT event_id,run_id FROM review_inbox').fetchall()
    assert rows == [(sys.argv[1], sys.argv[2])], 'Reenvio ou autenticação criou eventos indevidos'
print('1 evento persistido; reenvios não duplicaram o recebimento')
"""
    verified = command([
        "docker", "run", "--rm", "--network", "none", "--read-only", "--cap-drop", "ALL",
        "--security-opt", "no-new-privileges", "--memory", "256m", "--cpus", "1", "--pids-limit", "64",
        "--user", "10001:10001", "--mount", f"type=volume,src={volumes[0]},dst=/inbox,readonly",
        "--entrypoint", "python", image, "-c", inspection, receipt["event_id"], receipt["run_id"],
    ])
    print("PASS · quatro aplicações Compose, PostgreSQL, auditoria Blazor e FastAPI → n8n → Inbox")
    print("PASS · isolamento de sessão, autenticação do workflow/Inbox e " + verified)


if __name__ == "__main__":
    if sys.argv[1:] == ["--inside"]:
        browser = client()
        wait_until_ready(browser)
        products(browser)
        print(json.dumps(automation(browser)))
    elif not sys.argv[1:]:
        host()
    else:
        raise SystemExit("Uso: python tests/compose_verify.py")
