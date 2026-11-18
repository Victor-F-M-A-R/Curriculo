"""Queries and transaction boundaries for the telemetry ledger."""

from pathlib import Path

SQL_DIR = Path(__file__).resolve().parent / "sql"


def migrate(connection):
    # Multiple application workers may start against the same database.
    connection.execute("SELECT pg_advisory_xact_lock(711909240)")
    connection.execute("CREATE SCHEMA IF NOT EXISTS rastro")
    connection.execute(
        "CREATE TABLE IF NOT EXISTS rastro.migrations "
        "(version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())"
    )
    if not connection.execute("SELECT 1 FROM rastro.migrations WHERE version = 1").fetchone():
        connection.execute((SQL_DIR / "001_telemetry.sql").read_text())
        connection.execute("INSERT INTO rastro.migrations (version) VALUES (1)")


def ingest(connection, event):
    row = connection.execute(
        "SELECT rastro.ingest(%(vehicle_id)s, %(event_id)s::uuid, %(observed_at)s::timestamptz, "
        "%(device_seq)s::integer, %(latitude)s::numeric, %(longitude)s::numeric, "
        "%(speed_kmh)s::smallint) AS outcome",
        event,
    ).fetchone()
    return row["outcome"]


def fleet(connection):
    return connection.execute(
        """
        SELECT v.vehicle_id, v.name, v.route, e.event_id, e.observed_at, e.latitude, e.longitude,
               e.speed_kmh, COALESCE(s.unique_count, 0) AS unique_count,
               COALESCE(s.late_count, 0) AS late_count
        FROM rastro.vehicles AS v
        LEFT JOIN rastro.vehicle_state AS s USING (vehicle_id)
        LEFT JOIN rastro.telemetry_events AS e
          ON (e.vehicle_id, e.event_id) = (s.vehicle_id, s.current_event)
        ORDER BY v.vehicle_id
        """
    ).fetchall()


def history(connection, vehicle_id, limit):
    return connection.execute(
        """
        SELECT event_id, observed_at, device_seq, latitude, longitude, speed_kmh, arrived_late
        FROM rastro.telemetry_events WHERE vehicle_id = %s
        ORDER BY observed_at DESC, device_seq DESC LIMIT %s
        """,
        (vehicle_id, limit),
    ).fetchall()
