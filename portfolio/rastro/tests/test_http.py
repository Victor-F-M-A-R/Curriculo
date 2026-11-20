import json
import asyncio
import os
import secrets
import socket
import threading
import time
import unittest
from datetime import datetime, timedelta, timezone
from http.client import HTTPConnection
from unittest.mock import patch
from uuid import uuid4

import psycopg
import uvicorn
from fastapi import FastAPI

from app import app, lifespan
import repository as repo


class HttpContractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.key = secrets.token_urlsafe()
        environment = patch.dict(os.environ, {"RASTRO_DEMO": "0", "RASTRO_INGEST_TOKEN": cls.key})
        environment.start()
        cls.addClassCleanup(environment.stop)
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.bind(("127.0.0.1", 0))
        cls.port = sock.getsockname()[1]
        cls.addClassCleanup(sock.close)
        cls.server = uvicorn.Server(uvicorn.Config(app, log_level="error", access_log=False))
        cls.thread = threading.Thread(target=cls.server.run, kwargs={"sockets": [sock]}, daemon=True)
        cls.thread.start()
        cls.addClassCleanup(cls.stop_server)
        deadline = time.monotonic() + 12
        while cls.thread.is_alive() and not cls.server.started and time.monotonic() < deadline:
            time.sleep(.02)
        if not cls.server.started:
            raise RuntimeError("O servidor de teste do Rastro não iniciou.")

    @classmethod
    def stop_server(cls):
        cls.server.should_exit = True
        cls.thread.join(timeout=8)

    def setUp(self):
        self.asset = "HTTP-" + uuid4().hex[:12].upper()
        with psycopg.connect(os.environ["RASTRO_DATABASE_URL"]) as db:
            db.execute("INSERT INTO rastro.vehicles VALUES (%s, 'API', 'Teste local')", (self.asset,))
        self.addCleanup(self.remove_vehicle)
        self.event = {"vehicle_id": self.asset, "event_id": str(uuid4()),
                      "observed_at": "2025-06-03T09:00:00-03:00", "device_seq": 1,
                      "latitude": -23.5, "longitude": -46.6, "speed_kmh": 34}

    def remove_vehicle(self):
        with psycopg.connect(os.environ["RASTRO_DATABASE_URL"]) as db:
            db.execute("DELETE FROM rastro.vehicles WHERE vehicle_id = %s", (self.asset,))

    def request(self, method, path, payload=None, token=None, headers=None):
        headers = {"Content-Type": "application/json", **(headers or {})}
        if token is not None:
            headers["Authorization"] = "Bearer " + token
        conn = HTTPConnection("127.0.0.1", self.port, timeout=5)
        try:
            conn.request(method, path, body=json.dumps(payload) if payload is not None else None,
                         headers=headers)
            response = conn.getresponse()
            raw = response.read()
            try:
                body = json.loads(raw)
            except json.JSONDecodeError:
                body = raw.decode("utf-8", errors="replace")
            return response.status, body
        finally:
            conn.close()

    def test_authenticated_ingest_replay_and_conflict(self):
        post = lambda event: self.request("POST", "/api/events", event, self.key)
        self.assertEqual(post(self.event), (201, {"outcome": "advanced"}))
        self.assertEqual(post(self.event), (200, {"outcome": "replay"}))
        self.assertEqual(post({**self.event, "speed_kmh": 17})[0], 409)
        status, data = self.request("GET", f"/api/vehicles/{self.asset}/events")
        self.assertEqual((status, len(data["events"]), data["events"][0]["speed_kmh"]), (200, 1, 34))

    def test_unknown_vehicle_bad_timestamp_and_boundaries_leave_no_event(self):
        post = lambda event: self.request("POST", "/api/events", event, self.key)[0]
        self.assertEqual(post({**self.event, "vehicle_id": "UNREGISTERED-" + uuid4().hex[:8].upper()}), 404)
        self.assertEqual(post({**self.event, "observed_at": "2025-06-03T09:00:00"}), 422)
        future = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
        self.assertEqual(post({**self.event, "observed_at": future}), 422)
        self.assertEqual(post({**self.event, "latitude": 95}), 422)
        self.assertEqual(post({**self.event, "longitude": -46.1234567}), 422)
        self.assertEqual(self.request("GET", f"/api/vehicles/{self.asset}/events")[1]["events"], [])

    def test_ingest_requires_token_and_demo_can_be_disabled(self):
        self.assertEqual(self.request("POST", "/api/events", self.event)[0], 401)
        self.assertEqual(self.request("POST", "/api/events", self.event, "wrong-token")[0], 401)
        self.assertEqual(self.request("POST", "/api/demo/scenario")[0], 404)
        self.assertFalse(self.request("GET", "/api/fleet")[1]["demo"])

    def test_external_ingest_is_disabled_without_configured_token(self):
        with patch.object(app.state, "token", ""):
            self.assertEqual(self.request("POST", "/api/events", self.event, self.key)[0], 503)
        self.assertEqual(self.request("GET", f"/api/vehicles/{self.asset}/events")[1]["events"], [])

    def test_history_rejects_missing_vehicle_and_unbounded_limit(self):
        path = f"/api/vehicles/{self.asset}/events"
        self.assertEqual(self.request("GET", path + "?limit=0")[0], 422)
        self.assertEqual(self.request("GET", path + "?limit=101")[0], 422)
        self.assertEqual(self.request("GET", "/api/vehicles/NOT-REGISTERED/events")[0], 404)

    def test_lock_timeout_rolls_back_and_same_event_can_be_retried(self):
        # Hold the vehicle from a second connection to reproduce a busy writer.
        with psycopg.connect(os.environ["RASTRO_DATABASE_URL"]) as blocker:
            blocker.execute("SELECT 1 FROM rastro.vehicles WHERE vehicle_id = %s FOR UPDATE", (self.asset,))
            status, payload = self.request("POST", "/api/events", self.event, self.key)
            self.assertEqual((status, payload), (503, {"detail": "Banco de dados indisponível."}))
            self.assertEqual(self.request("GET", f"/api/vehicles/{self.asset}/events")[1]["events"], [])
        self.assertEqual(self.request("POST", "/api/events", self.event, self.key),
                         (201, {"outcome": "advanced"}))

    def test_integer_fields_reject_coercion_and_nonfinite_values_return_json(self):
        for field in ("device_seq", "speed_kmh"):
            for value in (True, False, "1", 1.0):
                with self.subTest(field=field, value=value):
                    status, body = self.request("POST", "/api/events", {**self.event, field: value}, self.key)
                    self.assertEqual(status, 422)
                    self.assertIsInstance(body, dict)
        for field in ("latitude", "longitude"):
            for value in (float("nan"), float("inf"), float("-inf")):
                with self.subTest(field=field, value=str(value)):
                    status, body = self.request("POST", "/api/events", {**self.event, field: value}, self.key)
                    self.assertEqual(status, 422)
                    self.assertIsInstance(body, dict)
                    json.dumps(body, allow_nan=False)
        self.assertEqual(self.request("GET", f"/api/vehicles/{self.asset}/events")[1]["events"], [])

    def test_timestamps_require_text_with_explicit_timezone(self):
        for value in (1700000000, "1700000000", "2026-11-20T12:00:00", "not-a-time"):
            with self.subTest(value=value):
                self.assertEqual(self.request("POST", "/api/events", {**self.event, "observed_at": value}, self.key)[0], 422)

    def test_clock_skew_boundary_and_older_reading_do_not_erase_history(self):
        now = datetime(2026, 11, 20, 12, tzinfo=timezone.utc)
        with patch("app.datetime") as clock:
            clock.now.return_value = now
            boundary = {**self.event, "observed_at": (now + timedelta(minutes=5)).isoformat()}
            self.assertEqual(self.request("POST", "/api/events", boundary, self.key)[0], 201)
            too_new = {**boundary, "event_id": str(uuid4()), "device_seq": 2,
                       "observed_at": (now + timedelta(minutes=5, microseconds=1)).isoformat()}
            self.assertEqual(self.request("POST", "/api/events", too_new, self.key)[0], 422)
            older = {**boundary, "event_id": str(uuid4()), "device_seq": 0,
                     "observed_at": (now - timedelta(days=2)).isoformat()}
            self.assertEqual(self.request("POST", "/api/events", older, self.key), (201, {"outcome": "late"}))
        events = self.request("GET", f"/api/vehicles/{self.asset}/events")[1]["events"]
        self.assertEqual([event["device_seq"] for event in events], [1, 0])

    def test_geographic_and_integer_extremes_and_timezone_equivalence(self):
        edge = {**self.event, "latitude": 90, "longitude": -180, "speed_kmh": 220, "device_seq": 2147483647}
        self.assertEqual(self.request("POST", "/api/events", edge, self.key)[0], 201)
        equivalent = {**edge, "observed_at": "2025-06-03T12:00:00Z"}
        self.assertEqual(self.request("POST", "/api/events", equivalent, self.key), (200, {"outcome": "replay"}))
        for changes in ({"latitude": -90.000001}, {"longitude": 180.000001}, {"speed_kmh": 221},
                        {"device_seq": 2147483648}, {"device_seq": -1}, {"unexpected": 1}):
            with self.subTest(changes=changes):
                self.assertEqual(self.request("POST", "/api/events", {**edge, **changes}, self.key)[0], 422)

    def test_bearer_scheme_is_case_insensitive_but_credentials_are_exact(self):
        for authorization in ("Basic " + self.key, "Bearer wrong", "Bearer " + self.key + "extra", "Bearer"):
            with self.subTest(scheme=authorization.split()[0]):
                self.assertEqual(self.request("POST", "/api/events", self.event,
                                              headers={"Authorization": authorization})[0], 401)
        self.assertEqual(self.request("POST", "/api/events", self.event,
                                      headers={"Authorization": "bearer " + self.key})[0], 201)

    def test_duplicate_authorization_headers_are_rejected_without_writing(self):
        body = json.dumps(self.event).encode()
        conn = HTTPConnection("127.0.0.1", self.port, timeout=5)
        try:
            conn.putrequest("POST", "/api/events")
            conn.putheader("Content-Type", "application/json")
            conn.putheader("Content-Length", str(len(body)))
            conn.putheader("Authorization", "Bearer " + self.key)
            conn.putheader("Authorization", "Bearer wrong")
            conn.endheaders(body)
            response = conn.getresponse()
            self.assertEqual(response.status, 401)
            self.assertEqual(response.getheader("WWW-Authenticate"), "Bearer")
            self.assertEqual(response.getheader("Cache-Control"), "no-store")
            response.read()
        finally:
            conn.close()
        self.assertEqual(self.request("GET", f"/api/vehicles/{self.asset}/events")[1]["events"], [])

    def test_dead_idle_database_connection_is_replaced(self):
        with app.state.pool.connection() as connection:
            pid = connection.execute("SELECT pg_backend_pid() AS pid").fetchone()["pid"]
        with psycopg.connect(os.environ["RASTRO_DATABASE_URL"]) as killer:
            killer.execute("SELECT pg_terminate_backend(%s)", (pid,))
        self.assertEqual(self.request("GET", "/health"), (200, {"status": "ok", "database": "PostgreSQL"}))

    def test_persisted_event_survives_new_application_lifespan(self):
        self.assertEqual(self.request("POST", "/api/events", self.event, self.key)[0], 201)
        async def reopen():
            restarted = FastAPI()
            async with lifespan(restarted):
                with restarted.state.pool.connection() as db:
                    rows = repo.history(db, self.asset, 10)
                    self.assertEqual([str(row["event_id"]) for row in rows], [self.event["event_id"]])
        asyncio.run(reopen())

    def test_history_cursor_keeps_order_without_duplicates_during_live_ingest(self):
        base = datetime(2025, 6, 3, 12, tzinfo=timezone.utc)
        def event(sequence, seconds):
            return {**self.event, "event_id": uuid4(), "device_seq": sequence,
                    "observed_at": base + timedelta(seconds=seconds)}
        with psycopg.connect(os.environ["RASTRO_DATABASE_URL"], row_factory=psycopg.rows.dict_row) as db:
            for sequence in range(12):
                repo.ingest(db, event(sequence, sequence * 10))
        path = f"/api/vehicles/{self.asset}/events?limit=3"
        status, first = self.request("GET", path)
        self.assertEqual(status, 200)
        self.assertTrue(first.get("next_cursor"), "History needs a continuation after the first page")
        with psycopg.connect(os.environ["RASTRO_DATABASE_URL"], row_factory=psycopg.rows.dict_row) as db:
            repo.ingest(db, event(12, 120))
            repo.ingest(db, event(99, 85))
        collected = list(first["events"])
        cursor = first["next_cursor"]
        while cursor:
            status, page = self.request("GET", path + "&cursor=" + cursor)
            self.assertEqual(status, 200)
            collected.extend(page["events"])
            cursor = page["next_cursor"]
        self.assertEqual([row["device_seq"] for row in collected], [11, 10, 9, 99, *range(8, -1, -1)])
        self.assertEqual(len({row["event_id"] for row in collected}), len(collected))
        self.assertEqual(self.request("GET", path)[1]["events"][0]["device_seq"], 12)
        self.assertEqual(self.request("GET", path + "&cursor=invalid")[0], 422)
        self.assertEqual(self.request("GET", "/api/vehicles/OTHER/events?cursor=" + first["next_cursor"])[0], 422)
