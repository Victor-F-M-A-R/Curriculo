import os
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from unittest.mock import patch
from uuid import uuid4

import psycopg
from psycopg.rows import dict_row

import demo
import repository as repo


def connect():
    return psycopg.connect(os.environ["RASTRO_DATABASE_URL"], row_factory=dict_row)


class TelemetryTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with connect() as db:
            repo.migrate(db)
            repo.migrate(db)

    def setUp(self):
        self.asset = "TEST-" + uuid4().hex[:12].upper()
        self.start = datetime(2025, 1, 1, 12, tzinfo=timezone.utc)
        with connect() as db:
            db.execute("INSERT INTO rastro.vehicles VALUES (%s, 'Teste', 'Circuito sintético')", (self.asset,))
        self.addCleanup(self.remove_test_vehicle)

    def remove_test_vehicle(self):
        with connect() as db:
            db.execute("DELETE FROM rastro.vehicles WHERE vehicle_id = %s", (self.asset,))

    def event(self, seq, seconds):
        return {"vehicle_id": self.asset, "event_id": uuid4(),
                "observed_at": self.start + timedelta(seconds=seconds), "device_seq": seq,
                "latitude": Decimal("-23.504123"), "longitude": Decimal("-46.581234"), "speed_kmh": 33}

    def state(self, db):
        return next(v for v in repo.fleet(db) if v["vehicle_id"] == self.asset)

    def test_out_of_order_and_replay_preserve_head_and_count(self):
        first, later, old = self.event(1, 0), self.event(3, 120), self.event(2, 60)
        with connect() as db:
            self.assertEqual([repo.ingest(db, v) for v in (first, later, old, old)],
                             ["advanced", "advanced", "late", "replay"])
            state = self.state(db)
            self.assertEqual((state["event_id"], state["unique_count"], state["late_count"]),
                             (later["event_id"], 3, 1))
            history = repo.history(db, self.asset, 5)
            self.assertEqual([r["device_seq"] for r in history], [3, 2, 1])
            self.assertTrue(history[1]["arrived_late"])

    def test_tied_device_time_uses_sequence_and_rejects_conflicting_slot(self):
        current, old = self.event(9, 30), self.event(8, 30)
        with connect() as db:
            self.assertEqual(repo.ingest(db, current), "advanced")
            self.assertEqual(repo.ingest(db, old), "late")
            self.assertEqual(repo.ingest(db, {**old, "event_id": uuid4()}), "conflict")
            self.assertEqual(repo.ingest(db, {**current, "speed_kmh": 40}), "conflict")
            self.assertEqual(self.state(db)["unique_count"], 2)
            self.assertEqual(repo.history(db, self.asset, 1)[0]["speed_kmh"], 33)

    def test_racing_deliveries_converge(self):
        event = self.event(5, 90)
        barrier = threading.Barrier(2)

        def send():
            with connect() as db:
                barrier.wait(timeout=10)
                return repo.ingest(db, event)

        with ThreadPoolExecutor(max_workers=2) as pool:
            deliveries = [pool.submit(send) for _ in range(2)]
            self.assertCountEqual([f.result(timeout=15) for f in deliveries], ["advanced", "replay"])
        with connect() as db:
            self.assertEqual(self.state(db)["unique_count"], 1)

    def test_two_processes_with_different_device_times_keep_newest(self):
        first, later = self.event(2, 10), self.event(3, 20)
        barrier = threading.Barrier(2)

        def send(item):
            with connect() as db:
                barrier.wait(timeout=10)
                return repo.ingest(db, item)

        with ThreadPoolExecutor(max_workers=2) as pool:
            list(pool.map(send, [first, later]))
        with connect() as db:
            state = self.state(db)
            self.assertEqual((state["event_id"], state["unique_count"]), (later["event_id"], 2))

    def test_batch_rolls_back_events_and_projection_together(self):
        event = self.event(1, 0)
        with connect() as db:
            with self.assertRaises(psycopg.errors.CheckViolation), db.transaction():
                repo.ingest(db, event)
                repo.ingest(db, {**self.event(2, 5), "speed_kmh": 300})
            self.assertEqual(self.state(db)["unique_count"], 0)
            self.assertEqual(repo.history(db, self.asset, 10), [])

    def test_demo_is_bounded_and_truthful_on_second_run(self):
        with connect() as db, patch.object(demo, "DEMO_VEHICLE", self.asset):
            self.assertEqual([r["outcome"] for r in demo.send_scenario(db)], ["advanced", "replay", "late"])
            self.assertEqual([r["outcome"] for r in demo.send_scenario(db)], ["replay"] * 3)
            self.assertEqual(self.state(db)["unique_count"], 2)
