"""Small, repeatable, synthetic shift. IDs and device timestamps are stable."""

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import NAMESPACE_URL, uuid5

from repository import ingest

SHIFT = datetime(2026, 11, 18, 12, 0, tzinfo=timezone.utc)
DEMO_VEHICLE = "TRK-018"
VEHICLES = [
    (DEMO_VEHICLE, "Cedro", "Pátio Norte / Guarulhos", "-23.506700", "-46.565100"),
    ("TRK-027", "Ipê", "Terminal Leste / Arujá", "-23.434800", "-46.461200"),
    ("TRK-041", "Jacarandá", "Base Sul / Diadema", "-23.661200", "-46.622800"),
]


def reading(asset, sequence, minute, latitude, longitude, speed):
    return {
        "vehicle_id": asset,
        "event_id": uuid5(NAMESPACE_URL, f"rastro/synthetic/{asset}/{sequence}"),
        "observed_at": SHIFT + timedelta(minutes=minute),
        "device_seq": sequence,
        "latitude": Decimal(latitude),
        "longitude": Decimal(longitude),
        "speed_kmh": speed,
    }


def seed(connection):
    for asset, name, route, lat, lon in VEHICLES:
        connection.execute(
            "INSERT INTO rastro.vehicles (vehicle_id, name, route) VALUES (%s, %s, %s) "
            "ON CONFLICT DO NOTHING",
            (asset, name, route),
        )
        for seq, minute, offset, speed in [(1, 0, 0, 0), (2, 6, 1, 24), (3, 12, 2, 36)]:
            ingest(connection, reading(asset, seq, minute, Decimal(lat) + Decimal(".0031") * offset,
                                       Decimal(lon) + Decimal(".0042") * offset, speed))


def send_scenario(connection):
    latest = reading(DEMO_VEHICLE, 5, 24, "-23.492100", "-46.541300", 41)
    delayed = reading(DEMO_VEHICLE, 4, 18, "-23.496500", "-46.550400", 32)
    records = [latest, latest, delayed]
    return [
        {"sequence": event["device_seq"], "observed_at": event["observed_at"],
         "outcome": ingest(connection, event)}
        for event in records
    ]
