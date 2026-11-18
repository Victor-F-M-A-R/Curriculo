import json
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

from app import app


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

    def request(self, method, path, payload=None, token=None):
        headers = {"Content-Type": "application/json"}
        if token is not None:
            headers["Authorization"] = "Bearer " + token
        conn = HTTPConnection("127.0.0.1", self.port, timeout=5)
        try:
            conn.request(method, path, body=json.dumps(payload) if payload is not None else None,
                         headers=headers)
            response = conn.getresponse()
            return response.status, json.loads(response.read())
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
