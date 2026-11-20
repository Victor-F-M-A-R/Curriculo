"""HTTP contracts against a real, temporary Inbox process. Requires its Release build."""
import concurrent.futures
import http.client
import json
import os
from pathlib import Path
import socket
import sqlite3
import subprocess
import tempfile
import time
import unittest
import uuid


class InboxHttpTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory(prefix="inbox-http-")
        cls.database = Path(cls.directory.name) / "inbox.db"
        cls.token = uuid.uuid4().hex
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            cls.port = listener.getsockname()[1]
        cls.env = os.environ | {
            "INBOX_ENGINE": "sqlite", "INBOX_CONNECTION": f"Data Source={cls.database};Pooling=False",
            "INBOX_TOKEN": cls.token, "ASPNETCORE_URLS": f"http://127.0.0.1:{cls.port}",
            "ASPNETCORE_ENVIRONMENT": "Production", "Logging__LogLevel__Default": "Warning",
        }
        cls.start()

    @classmethod
    def start(cls):
        assembly = Path(__file__).resolve().parents[1] / "bin/Release/net10.0/Inbox.dll"
        if not assembly.is_file():
            raise RuntimeError("Build Inbox in Release before running its HTTP tests.")
        cls.process = subprocess.Popen(["dotnet", str(assembly)], env=cls.env,
            cwd=cls.directory.name, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            try:
                connection = http.client.HTTPConnection("127.0.0.1", cls.port, timeout=1)
                connection.request("GET", "/health")
                response = connection.getresponse()
                response.read()
                connection.close()
                if response.status == 200:
                    return
            except OSError:
                pass
            if cls.process.poll() is not None:
                raise RuntimeError("Inbox exited before becoming healthy.")
            time.sleep(0.1)
        cls.stop()
        raise RuntimeError("Inbox did not become healthy in 20 seconds.")

    @classmethod
    def stop(cls):
        cls.process.terminate()
        try:
            cls.process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            cls.process.kill()
            cls.process.wait(timeout=5)

    @classmethod
    def tearDownClass(cls):
        cls.stop()
        cls.directory.cleanup()

    def envelope(self):
        return {"event_id": uuid.uuid4().hex, "run_id": uuid.uuid4().hex, "kind": "review.requested"}

    def post(self, body, *, token=True, raw=False, chunked=False, path="/events"):
        payload = body if raw else json.dumps(body)
        headers = {"Content-Type": "application/json"}
        if token:
            headers["X-Inbox-Token"] = self.token if token is True else token
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        try:
            connection.request("POST", path, body=iter([payload.encode()]) if chunked else payload,
                               headers=headers, encode_chunked=chunked)
            response = connection.getresponse()
            return response.status, response.read().decode()
        finally:
            connection.close()

    def count(self, event_id):
        with sqlite3.connect(self.database) as db:
            return db.execute("select count(*) from review_inbox where lower(event_id)=?", (event_id,)).fetchone()[0]

    def test_authentication_precedes_body_parsing(self):
        self.assertEqual(401, self.post("{", raw=True, token=False)[0])
        self.assertEqual(401, self.post(self.envelope(), token="wrong-test-token")[0])
        for path in ("/events/", "/EVENTS"):
            self.assertEqual(401, self.post(self.envelope(), path=path, token=False)[0])

    def test_invalid_schema_json_and_content_type_are_rejected(self):
        for body in ("{", "null", "[]", "{}", json.dumps(self.envelope() | {"unexpected": True})):
            with self.subTest(body_kind=body[:2]):
                self.assertEqual(400, self.post(body, raw=True)[0])
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        connection.request("POST", "/events", json.dumps(self.envelope()),
                           {"Content-Type": "text/plain", "X-Inbox-Token": self.token})
        response = connection.getresponse()
        response.read()
        self.assertEqual(415, response.status)
        connection.close()

    def test_payload_limit_including_chunked_without_content_length(self):
        payload = json.dumps(self.envelope() | {"extra": "x" * 5000})
        self.assertEqual(413, self.post(payload, raw=True)[0])
        self.assertEqual(413, self.post(payload, raw=True, chunked=True)[0])

    def test_invalid_content_length_rejected_by_http_server(self):
        with socket.create_connection(("127.0.0.1", self.port), timeout=5) as connection:
            connection.sendall(b"POST /events HTTP/1.1\r\nHost: localhost\r\nContent-Length: nope\r\nConnection: close\r\n\r\n")
            response = connection.recv(1024)
        self.assertIn(b" 400 ", response.split(b"\r\n")[0])

    def test_replay_case_concurrency_and_conflicting_content(self):
        body = self.envelope()
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            variants = [body, body | {"event_id": body["event_id"].upper(), "run_id": body["run_id"].upper()}] * 3
            results = list(pool.map(self.post, variants))
        self.assertTrue(all(status == 200 for status, _ in results))
        self.assertEqual(1, self.count(body["event_id"]))
        self.assertEqual(409, self.post(body | {"run_id": uuid.uuid4().hex})[0])
        self.assertEqual(409, self.post(body | {"kind": "review.cancelled"})[0])
        self.assertEqual(400, self.post(self.envelope() | {"kind": "unknown"})[0])

    def test_request_disconnect_is_safe_to_resend(self):
        body = self.envelope()
        payload = json.dumps(body).encode()
        with socket.create_connection(("127.0.0.1", self.port), timeout=5) as connection:
            headers = (f"POST /events HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\n"
                       f"X-Inbox-Token: {self.token}\r\nContent-Length: {len(payload)}\r\n\r\n").encode()
            connection.sendall(headers + payload)
        self.assertEqual(200, self.post(body)[0])
        self.assertEqual(200, self.post(body)[0])
        self.assertEqual(1, self.count(body["event_id"]))

    def test_database_lock_returns_503_then_recovers(self):
        body = self.envelope()
        with sqlite3.connect(self.database) as db:
            db.execute("begin immediate")
            started = time.monotonic()
            status, content = self.post(body)
            self.assertEqual(503, status)
            self.assertLess(time.monotonic() - started, 10)
            self.assertNotIn(str(self.database), content)
            db.rollback()
        self.assertEqual(200, self.post(body)[0])
        self.assertEqual(1, self.count(body["event_id"]))

    def test_restart_preserves_committed_event(self):
        body = self.envelope()
        self.assertEqual(200, self.post(body)[0])
        self.stop()
        self.start()
        self.assertEqual(200, self.post(body)[0])
        self.assertEqual(1, self.count(body["event_id"]))


if __name__ == "__main__":
    unittest.main(verbosity=2)
