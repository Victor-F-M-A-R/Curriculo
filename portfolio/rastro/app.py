"""Local fleet monitor backed by PostgreSQL."""

import hmac
import os
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from typing import Annotated
from uuid import UUID

from fastapi import FastAPI, Header, HTTPException, Query, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from psycopg import OperationalError
from psycopg.errors import LockNotAvailable, QueryCanceled
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool, PoolTimeout
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field

import demo
import repository as repo

WEB = Path(__file__).resolve().parent / "web"


class Reading(BaseModel):
    model_config = ConfigDict(extra="forbid")

    vehicle_id: str = Field(pattern=r"^[A-Z0-9-]{1,24}$")
    event_id: UUID
    observed_at: AwareDatetime
    device_seq: int = Field(ge=0, le=2147483647)
    latitude: Decimal = Field(ge=-90, le=90, max_digits=9, decimal_places=6)
    longitude: Decimal = Field(ge=-180, le=180, max_digits=9, decimal_places=6)
    speed_kmh: int = Field(ge=0, le=220)


@asynccontextmanager
async def lifespan(app):
    url = os.environ["RASTRO_DATABASE_URL"]
    app.state.demo = os.getenv("RASTRO_DEMO", "") == "1"
    app.state.token = os.environ.get("RASTRO_INGEST_TOKEN", "")
    with ConnectionPool(url, min_size=1, max_size=6, timeout=5, open=False,
                        kwargs={"row_factory": dict_row, "connect_timeout": 4,
                                "options": "-c statement_timeout=8000 -c lock_timeout=2000"}) as pool:
        pool.wait(timeout=25)
        with pool.connection() as db:
            repo.migrate(db)
            if app.state.demo:
                demo.seed(db)
        app.state.pool = pool
        yield


app = FastAPI(title="Rastro", version="1.0.0", lifespan=lifespan, docs_url=None, redoc_url=None)


@app.middleware("http")
async def browser_headers(request, call_next):
    response = await call_next(request)
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; "
        "connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
    )
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    return response


@app.exception_handler(OperationalError)
@app.exception_handler(PoolTimeout)
@app.exception_handler(LockNotAvailable)
@app.exception_handler(QueryCanceled)
async def unavailable(request, exc):
    return JSONResponse(status_code=503, content={"detail": "Banco de dados indisponível."})


@app.get("/health")
def health(request: Request):
    with request.app.state.pool.connection() as db:
        db.execute("SELECT 1").fetchone()
    return {"status": "ok", "database": "PostgreSQL"}


@app.get("/api/fleet")
def list_fleet(request: Request):
    with request.app.state.pool.connection() as db:
        rows = repo.fleet(db)
    return {"vehicles": rows, "demo": request.app.state.demo}


@app.get("/api/vehicles/{vehicle_id}/events")
def recent_events(request: Request, vehicle_id: str, limit: Annotated[int, Query(ge=1, le=100)] = 20):
    with request.app.state.pool.connection() as db:
        if not db.execute("SELECT 1 FROM rastro.vehicles WHERE vehicle_id = %s", (vehicle_id,)).fetchone():
            raise HTTPException(404, "Veículo não cadastrado.")
        return {"events": repo.history(db, vehicle_id, limit)}


@app.post("/api/events")
def post_event(request: Request, event: Reading, authorization: Annotated[str, Header()] = ""):
    token = request.app.state.token
    if not token:
        raise HTTPException(503, "Ingestão externa desativada.")
    if not hmac.compare_digest(authorization.encode(), f"Bearer {token}".encode()):
        raise HTTPException(401, "Credencial de ingestão inválida.", headers={"WWW-Authenticate": "Bearer"})
    if event.observed_at > datetime.now(timezone.utc) + timedelta(minutes=5):
        raise HTTPException(422, "Relógio do dispositivo adiantado em mais de cinco minutos.")
    with request.app.state.pool.connection() as db:
        result = repo.ingest(db, event.model_dump())
    if result == "unknown_vehicle":
        raise HTTPException(404, "Veículo não cadastrado.")
    if result == "conflict":
        raise HTTPException(409, "Identidade ou sequência conflitante com o evento registrado.")
    return JSONResponse(status_code=200 if result == "replay" else 201, content={"outcome": result})


@app.post("/api/demo/scenario")
def run_demo(request: Request, x_rastro_client: Annotated[str, Header()] = ""):
    if not request.app.state.demo:
        raise HTTPException(404, "Demonstração indisponível.")
    if x_rastro_client != "monitor":
        raise HTTPException(403, "Use o monitor local para simular a chegada.")
    with request.app.state.pool.connection() as db:
        batch = demo.send_scenario(db)
    return {"vehicle_id": demo.DEMO_VEHICLE, "receipts": batch}


@app.get("/", include_in_schema=False)
def home():
    return FileResponse(WEB / "index.html")


app.mount("/assets", StaticFiles(directory=WEB), name="assets")
