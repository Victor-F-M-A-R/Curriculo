import os
import tempfile
import unittest
from unittest.mock import patch

import storage
from app import INDEX, app
from fastapi.testclient import TestClient
from search import answer


class FarolTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.env = patch.dict(
            os.environ,
            {
                "FAROL_DB": self.temp.name + "/suite.db",
                "REVIEW_WEBHOOK_URL": "",
                "LLM_MODEL": "",
            },
        )
        self.env.start()
        self.client = TestClient(app, headers={"X-Farol-Client": "desk"})
        self.client.__enter__()

    def tearDown(self):
        self.client.__exit__(None, None, None)
        self.env.stop()
        self.temp.cleanup()

    def test_citation_is_a_literal_passage(self):
        item = self.client.post(
            "/api/ask",
            json={"query": "Quantas falhas na WAN Ipê fazem a Cedro assumir?"},
        ).json()
        self.assertEqual(item["state"], "answered")
        self.assertEqual(item["evidence"][0]["id"], "RB-01#s1")
        self.assertIn(item["answer"], item["evidence"][0]["text"])
        self.assertEqual(self.client.get("/api/runs").json()[0]["id"], item["id"])

    def test_unanswered_nearby_question_and_review_replay(self):
        item = self.client.post(
            "/api/ask",
            json={"query": "Qual é o preço mensal do contrato da WAN Cedro?"},
        ).json()
        self.assertEqual(item["state"], "abstained")
        self.assertEqual(item["evidence"], [])
        for _ in range(2):
            self.assertEqual(
                self.client.post(f"/api/runs/{item['id']}/review").json()["delivery"],
                "local",
            )
        with storage.connection() as db:
            self.assertEqual(
                db.execute("select count(*) from reviews").fetchone()[0], 1
            )

    def test_session_isolation_delete_and_request_guard(self):
        item = self.client.post(
            "/api/ask", json={"query": "Como verificar o toner?"}
        ).json()
        with TestClient(app) as other:
            self.assertEqual(other.get(f"/api/runs/{item['id']}").status_code, 404)
            self.assertEqual(
                other.post("/api/ask", json={"query": "teste de sessão"}).status_code,
                403,
            )
        self.assertEqual(self.client.delete("/api/runs").status_code, 204)
        self.assertEqual(self.client.get("/api/runs").json(), [])

    def test_reject_unknown_manual(self):
        self.assertEqual(
            self.client.post(
                "/api/ask", json={"query": "quem assume?", "document": "XX"}
            ).status_code,
            404,
        )

    def test_model_cannot_introduce_unquoted_text(self):
        # Provider contract only. No remote model or paid call is used.
        q = "Quantas falhas na WAN Ipê fazem a Cedro assumir?"
        from unittest.mock import Mock

        response = Mock()
        response.json.return_value = {
            "choices": [
                {
                    "message": {
                        "content": '{"id":"RB-01#s1","quote":"informação inteiramente inventada pelo modelo"}'
                    }
                }
            ]
        }
        with (
            patch.dict(
                os.environ,
                {"LLM_BASE_URL": "http://model.invalid", "LLM_MODEL": "fixture"},
            ),
            patch("search.httpx.post", return_value=response),
        ):
            out = answer(INDEX, q)
        self.assertEqual(out["mode"], "extrativo de contingência")
        self.assertNotIn("inventada", out["answer"])

    def test_time_question_keeps_the_interval_when_the_editor_drops_it(self):
        import json
        from search import select_with_model
        from unittest.mock import Mock

        query = (
            "A falha P1 atingiu dois blocos. De quanto em quanto tempo sai um informe?"
        )
        section = next(p for p in INDEX.passages if p.id == "RB-05#s1")
        fragment = next(
            s.strip() + "." for s in section.text.split(".") if "quais blocos" in s
        )
        response = Mock()
        response.json.return_value = {
            "choices": [
                {
                    "message": {
                        "content": json.dumps({"id": section.id, "quote": fragment})
                    }
                }
            ]
        }
        with (
            patch.dict(
                os.environ,
                {"LLM_BASE_URL": "http://model.invalid", "LLM_MODEL": "fixture"},
            ),
            patch("search.httpx.post", return_value=response),
        ):
            _, quote = select_with_model(query, [(1, section)])
        self.assertIn("15 minutos", quote)

    def test_outbox_lease_and_retry(self):
        result = self.client.post(
            "/api/ask", json={"query": "Quais os sintomas de toner baixo?"}
        ).json()
        sid = self.client.cookies["farol-session"]
        storage.review(sid, result["id"], True)
        one = storage.claim()
        self.assertIsNotNone(one)
        self.assertIsNone(storage.claim())
        storage.finish(one, False)
        with storage.connection() as db:
            db.execute("update reviews set next_at=0")
        two = storage.claim()
        self.assertEqual(one["id"], two["id"])
        storage.finish(two, True)
        self.assertEqual(storage.get(sid, result["id"])["delivery"], "delivered")
