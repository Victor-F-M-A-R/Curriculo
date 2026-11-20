import os
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

import storage
from app import INDEX, app
from fastapi.testclient import TestClient
from evaluate import evaluate_content, grade_content
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

    def test_change_approval_and_window_survive_the_paraphrase(self):
        item = self.client.post(
            "/api/ask",
            json={"query": "Quem dá o aceite de uma mudança programada e quando podemos executá-la?"},
        ).json()
        self.assertEqual(item["evidence"][0]["id"], "RB-06#s1")
        for fact in ("responsável técnico", "gestor do serviço", "19h às 20h"):
            self.assertIn(fact, item["answer"])

    def test_contact_question_requires_both_field_and_subject_in_the_passage(self):
        missing = answer(INDEX, "Qual o telefone do fabricante do Chromebook?", use_model=False)
        present = answer(INDEX, "Onde aparece o nome do receptor para projeção sem fio?", use_model=False)
        self.assertEqual(missing["state"], "abstained")
        self.assertEqual(present["evidence"][0]["id"], "RB-03#s2")

    def test_right_section_with_incomplete_answer_fails_content_grade(self):
        passage = next(p for p in INDEX.passages if p.id == "RB-05#s1")
        quote = "Registre no chamado quais blocos estão afetados."
        case = {"id": "partial", "query": "De quanto em quanto tempo?", "expected": [passage.id],
                "facts": ["15 minutos"]}
        result = {"state": "answered", "mode": "fixture", "answer": quote,
                  "evidence": [{"id": passage.id, "quote": quote}]}
        row = grade_content(case, result, {passage.id: passage.text})
        self.assertTrue(row["source_correct"] and row["literal"])
        self.assertEqual(row["missing_facts"], ["15 minutos"])
        self.assertFalse(row["pass"])

    def test_content_regression_matches_the_facts_and_refusals(self):
        rows = evaluate_content()["rows"]
        self.assertEqual([row["id"] for row in rows if not row["pass"]], [])

    def test_two_simultaneous_reviews_create_one_event(self):
        ident = storage.save("same-session", "Consulta para revisar", {})
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = [pool.submit(storage.review, "same-session", ident, True) for _ in range(2)]
        self.assertEqual([future.result() for future in results], ["queued", "queued"])
        with storage.connection() as db:
            self.assertEqual(db.execute("select count(*) from reviews where run_id=?", (ident,)).fetchone()[0], 1)

    def test_old_runs_hidden_on_read_even_without_a_new_question(self):
        sid = "test-session"
        expired = storage.save(sid, "Encerrada", {})
        pending = storage.save(sid, "Entrega em andamento", {})
        storage.review(sid, pending, True)
        with storage.connection() as db:
            db.execute("update runs set created=0")
        self.assertEqual([r["id"] for r in storage.list_runs(sid)], [pending])
        self.assertIsNone(storage.get(sid, expired))
        self.assertIsNone(storage.review(sid, expired, True))
        self.assertIsNone(storage.review("other-session", pending, True))
        self.assertEqual(storage.get(sid, pending)["delivery"], "queued")

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

    def test_incident_update_interval_retains_context_for_the_other_deadline(self):
        from search import select_with_model
        section = next(p for p in INDEX.passages if p.id == "RB-05#s1")
        acknowledgement = "O plantonista confirma o recebimento em até cinco minutos"
        with patch("search.model_json", return_value={"id": section.id, "quote": acknowledgement}):
            _, quote = select_with_model("Qual é o intervalo entre os informes P1?", [(1, section)])
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

    def test_contract_rejects_whitespace_oversize_types_and_unknown_fields(self):
        for body in ({'query':'    '}, {'query':'x'*501}, {'query':12345},
                     {'query':'Como verificar toner?', 'document':99},
                     {'query':'Como verificar toner?', 'session':'someone-else'}):
            with self.subTest(body=body):
                self.assertEqual(self.client.post('/api/ask', json=body).status_code, 422)
        self.assertEqual(self.client.get('/api/runs').json(), [])

    def test_reset_invalidates_an_answer_in_flight(self):
        sid = 'simultaneous-session'
        before = storage.version(sid)
        storage.erase(sid)
        self.assertIsNone(storage.save(sid, 'Resposta antiga', {}, expected_version=before))
        self.assertEqual(storage.list_runs(sid), [])
        after = storage.version(sid)
        self.assertIsNotNone(storage.save(sid, 'Resposta nova', {}, expected_version=after))

    def test_api_reset_during_answer_returns_conflict_without_resurrecting_history(self):
        self.client.get('/api/catalog')
        sid = self.client.cookies['farol-session']
        def compute(*args):
            storage.erase(sid)
            return {'state':'abstained', 'evidence':[], 'answer':'sem evidência'}
        with patch('app.answer', side_effect=compute):
            self.assertEqual(self.client.post('/api/ask', json={'query':'Pergunta em voo'}).status_code, 409)
        self.assertEqual(self.client.get('/api/runs').json(), [])

    def test_restarted_worker_expires_final_attempt_and_ignores_stale_completion(self):
        ident = storage.save('session', 'Revisão após reinício', {})
        storage.review('session', ident, True)
        first = storage.claim()
        with storage.connection() as db:
            db.execute('update reviews set next_at=0')
        storage.initialize()
        second = storage.claim()
        self.assertEqual(second['id'], first['id'])
        storage.finish(first, True)
        self.assertEqual(storage.get('session', ident)['delivery'], 'sending')
        storage.finish(second, False)
        for _ in range(4):
            with storage.connection() as db:
                db.execute('update reviews set next_at=0')
            self.assertIsNotNone(storage.claim())
        with storage.connection() as db:
            db.execute('update reviews set next_at=0')
        storage.initialize()
        self.assertIsNone(storage.claim())
        self.assertEqual(storage.get('session', ident)['delivery'], 'failed')

    def test_reset_removes_pending_review_and_late_ack_cannot_recreate_it(self):
        ident = storage.save('session', 'Apagar fila', {})
        storage.review('session', ident, True)
        item = storage.claim()
        storage.erase('session')
        storage.finish(item, True)
        self.assertIsNone(storage.get('session', ident))
        self.assertIsNone(storage.claim())
        with storage.connection() as db:
            self.assertEqual(db.execute('select count(*) from reviews').fetchone()[0], 0)
