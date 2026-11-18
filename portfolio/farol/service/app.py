import asyncio
import os
import secrets
from contextlib import asynccontextmanager, suppress
from pathlib import Path

import httpx
import storage
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from search import Index, answer

INDEX = Index(path=os.getenv("FAROL_INDEX_DB", ":memory:"))


async def deliver():
    url = os.environ["REVIEW_WEBHOOK_URL"]
    token = os.environ["REVIEW_WEBHOOK_TOKEN"]
    async with httpx.AsyncClient(timeout=6) as client:
        while True:
            item = await asyncio.to_thread(storage.claim)
            if item is None:
                await asyncio.sleep(2)
                continue
            event = {
                "event_id": item["id"],
                "run_id": item["run_id"],
                "kind": "review.requested",
            }
            try:
                res = await client.post(
                    url,
                    json=event,
                    headers={"X-Farol-Token": token, "Idempotency-Key": item["id"]},
                )
                res.raise_for_status()
                ok = res.json().get("event_id") == item["id"]
            except (httpx.HTTPError, ValueError, AttributeError):
                ok = False
            await asyncio.to_thread(storage.finish, item, ok)


@asynccontextmanager
async def lifespan(_):
    storage.initialize()
    if os.getenv("REVIEW_WEBHOOK_URL") and not os.getenv("REVIEW_WEBHOOK_TOKEN"):
        raise RuntimeError("Configure REVIEW_WEBHOOK_TOKEN para habilitar a entrega.")
    worker = asyncio.create_task(deliver()) if os.getenv("REVIEW_WEBHOOK_URL") else None
    yield
    if worker:
        worker.cancel()
        with suppress(asyncio.CancelledError):
            await worker


app = FastAPI(title="Farol · Operações de campus", version="1.0.0", lifespan=lifespan)


class Question(BaseModel):
    query: str = Field(min_length=4, max_length=500)
    document: str | None = Field(default=None, max_length=16)


@app.middleware("http")
async def scoped(request: Request, call_next):
    if (
        request.url.path.startswith("/api/")
        and request.method in {"POST", "DELETE"}
        and request.headers.get("X-Farol-Client") != "desk"
    ):
        return Response(status_code=403)
    incoming = request.cookies.get("farol-session", "")
    existing = len(incoming) == 48 and all(c in "0123456789abcdef" for c in incoming)
    request.state.session = incoming if existing else secrets.token_hex(24)
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "same-origin"
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
        if not existing:
            response.set_cookie(
                "farol-session",
                request.state.session,
                httponly=True,
                samesite="strict",
                secure=os.getenv("COOKIE_SECURE", "0") == "1",
                max_age=7 * 86400,
            )
    return response


@app.get("/api/catalog")
def catalog():
    return INDEX.manual


@app.post("/api/ask")
def ask(body: Question, request: Request):
    query = " ".join(body.query.split())
    if len(query) < 4:
        raise HTTPException(422, "Escreva uma pergunta com quatro ou mais caracteres.")
    if body.document and not any(d["id"] == body.document for d in INDEX.manual):
        raise HTTPException(404, "Manual desconhecido.")
    result = answer(INDEX, query, body.document)
    return result | {
        "id": storage.save(request.state.session, query, result),
        "question": query,
        "delivery": None,
    }


@app.get("/api/runs")
def history(request: Request):
    return storage.list_runs(request.state.session)


@app.get("/api/runs/{ident}")
def run(ident: str, request: Request):
    result = storage.get(request.state.session, ident)
    if result is None:
        raise HTTPException(404, "Consulta desconhecida.")
    return result


@app.delete("/api/runs")
def erase(request: Request):
    with storage.connection() as db:
        db.execute("delete from runs where session=?", (request.state.session,))
    return Response(status_code=204)


@app.post("/api/runs/{ident}/review")
def review(ident: str, request: Request):
    delivery = storage.review(
        request.state.session, ident, os.getenv("REVIEW_WEBHOOK_URL")
    )
    if delivery is None:
        raise HTTPException(404, "Consulta desconhecida.")
    return {"delivery": delivery}


@app.get("/api/health")
def health():
    return {"status": "ok", "passages": len(INDEX.passages)}


static = Path(os.getenv("FAROL_WEB", Path(__file__).parent.parent / "web" / "dist"))
if static.is_dir():
    app.mount("/", StaticFiles(directory=static, html=True), name="desk")
