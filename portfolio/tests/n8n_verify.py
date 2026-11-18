"""Exercise the real exported n8n workflow, .NET receiver and FastAPI queue with disposable stores."""

import json
import os
import secrets
import shutil
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
import uuid
from pathlib import Path

import httpx
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]


def port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def wait_for(url, process):
    for _ in range(150):
        if process.poll() is not None:
            raise RuntimeError("Processo encerrou antes de ficar disponível.")
        try:
            if httpx.get(url, timeout=2).is_success:
                return
        except httpx.HTTPError:
            pass
        time.sleep(0.4)
    raise TimeoutError(url)


def main():
    # Every service used by this test is bound to loopback.
    os.environ.pop("ALL_PROXY", None)
    os.environ.pop("all_proxy", None)
    os.environ["NO_PROXY"] = os.environ["no_proxy"] = "127.0.0.1,localhost"
    n8n = shutil.which("n8n")
    if not n8n:
        raise SystemExit("Instale n8n 2.48.5 e disponibilize seu executável no PATH.")
    dll = ROOT / "farol/inbox/bin/Release/net10.0/Inbox.dll"
    if not dll.exists():
        raise SystemExit("Execute dotnet build farol/inbox -c Release.")
    inbound, receiver = secrets.token_hex(32), secrets.token_hex(32)
    n_port, i_port = port(), port()
    url = f"http://127.0.0.1:{n_port}"
    inbox = f"http://127.0.0.1:{i_port}"
    with tempfile.TemporaryDirectory(prefix="farol-flow-") as tmp:
        path = Path(tmp)
        flow = json.loads((ROOT / "farol/automation/review.n8n.json").read_text())
        http_node = next(
            n for n in flow["nodes"] if n["type"] == "n8n-nodes-base.httpRequest"
        )
        http_node["parameters"]["url"] = inbox + "/events"
        (path / "flow.json").write_text(json.dumps(flow))
        creds = [
            {
                "id": i,
                "name": n,
                "type": "httpHeaderAuth",
                "data": {"name": h, "value": v},
            }
            for i, n, h, v in [
                ("farol-inbound", "Farol inbound", "X-Farol-Token", inbound),
                ("farol-inbox", "Farol inbox", "X-Inbox-Token", receiver),
            ]
        ]
        (path / "creds.json").write_text(json.dumps(creds))
        (path / "creds.json").chmod(0o600)
        env = dict(
            os.environ,
            N8N_USER_FOLDER=tmp,
            N8N_LISTEN_ADDRESS="127.0.0.1",
            N8N_PORT=str(n_port),
            N8N_HOST="127.0.0.1",
            N8N_PROTOCOL="http",
            N8N_SECURE_COOKIE="false",
            N8N_ENCRYPTION_KEY=secrets.token_hex(32),
            WEBHOOK_URL=url + "/",
            N8N_RUNNERS_BROKER_PORT=str(port()),
            N8N_SSRF_PROTECTION_ENABLED="true",
            N8N_SSRF_ALLOWED_IP_RANGES="127.0.0.1/32",
            N8N_DIAGNOSTICS_ENABLED="false",
            N8N_VERSION_NOTIFICATIONS_ENABLED="false",
        )
        for args in [
            ["import:credentials", "--input=" + str(path / "creds.json")],
            ["import:workflow", "--input=" + str(path / "flow.json")],
            ["publish:workflow", "--id=" + flow["id"]],
        ]:
            subprocess.run([n8n, *args], env=env, check=True, stdout=subprocess.DEVNULL)
        procs = []
        try:
            for command, options in [
                ([n8n, "start"], env),
                (
                    ["dotnet", str(dll)],
                    dict(
                        os.environ,
                        ASPNETCORE_URLS=inbox,
                        INBOX_TOKEN=receiver,
                        INBOX_CONNECTION=f"Data Source={path / 'inbox.db'}",
                    ),
                ),
            ]:
                procs.append(
                    subprocess.Popen(
                        command, env=options, cwd=tmp, stdout=subprocess.DEVNULL
                    )
                )
            wait_for(url + "/healthz/readiness", procs[0])
            wait_for(inbox + "/health", procs[1])
            hook = url + "/webhook/farol-review"
            os.environ.update(
                FAROL_DB=str(path / "farol.db"),
                REVIEW_WEBHOOK_URL=hook,
                REVIEW_WEBHOOK_TOKEN=inbound,
                LLM_MODEL="",
            )
            sys.path.insert(0, str(ROOT / "farol/service"))
            from app import app

            envelope = {
                "run_id": uuid.uuid4().hex,
                "event_id": uuid.uuid4().hex,
                "kind": "review.requested",
            }
            assert httpx.post(hook, json=envelope).status_code in (401, 403)
            assert httpx.post(inbox + "/events", json=envelope).status_code == 401
            with TestClient(app, headers={"X-Farol-Client": "desk"}) as cli:
                result = cli.post(
                    "/api/ask",
                    json={"query": "Quem verifica a troca do link de internet?"},
                ).json()
                ident = result["id"]
                assert (
                    cli.post(f"/api/runs/{ident}/review").json()["delivery"] == "queued"
                )
                for _ in range(70):
                    if cli.get(f"/api/runs/{ident}").json()["delivery"] == "delivered":
                        break
                    time.sleep(0.25)
                else:
                    raise AssertionError("O webhook não confirmou a entrega.")
                with sqlite3.connect(path / "inbox.db") as db:
                    [(event, run)] = db.execute(
                        "select event_id,run_id from review_inbox"
                    ).fetchall()
                    assert run == ident
                    envelope.update(run_id=run, event_id=event)
                    result = httpx.post(
                        hook,
                        json=envelope,
                        headers={"X-Farol-Token": inbound},
                        timeout=10,
                    )
                    assert result.json()["event_id"] == event
                    assert (
                        db.execute("select count(*) from review_inbox").fetchone()[0]
                        == 1
                    )
            print(
                "PASS · entrega, confirmação, isolamento de credencial e reenvio idempotente"
            )
        finally:
            for proc in procs:
                proc.terminate()
            for proc in procs:
                try:
                    proc.wait(timeout=12)
                except subprocess.TimeoutExpired:
                    proc.kill()
                    proc.wait()


if __name__ == "__main__":
    main()
