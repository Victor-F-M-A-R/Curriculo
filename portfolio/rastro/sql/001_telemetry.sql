CREATE TABLE rastro.vehicles (
    vehicle_id text PRIMARY KEY,
    name text NOT NULL,
    route text NOT NULL
);

CREATE TABLE rastro.telemetry_events (
    vehicle_id text NOT NULL REFERENCES rastro.vehicles ON DELETE CASCADE,
    event_id uuid NOT NULL,
    observed_at timestamptz NOT NULL,
    device_seq integer NOT NULL CHECK (device_seq >= 0),
    latitude numeric(9, 6) NOT NULL CHECK (latitude BETWEEN -90 AND 90),
    longitude numeric(9, 6) NOT NULL CHECK (longitude BETWEEN -180 AND 180),
    speed_kmh smallint NOT NULL CHECK (speed_kmh BETWEEN 0 AND 220),
    received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    arrived_late boolean NOT NULL,
    PRIMARY KEY (vehicle_id, event_id)
);

-- One device sequence per instant. The same index serves the recent-history query.
CREATE UNIQUE INDEX telemetry_vehicle_order
    ON rastro.telemetry_events (vehicle_id, observed_at DESC, device_seq DESC)
    INCLUDE (event_id, latitude, longitude, speed_kmh, arrived_late);

CREATE TABLE rastro.vehicle_state (
    vehicle_id text PRIMARY KEY REFERENCES rastro.vehicles ON DELETE CASCADE,
    current_event uuid NOT NULL,
    unique_count bigint NOT NULL CHECK (unique_count > 0),
    late_count bigint NOT NULL CHECK (late_count BETWEEN 0 AND unique_count),
    FOREIGN KEY (vehicle_id, current_event)
        REFERENCES rastro.telemetry_events (vehicle_id, event_id) ON DELETE CASCADE
);

CREATE FUNCTION rastro.ingest(
    asset text, event_key uuid, observed timestamptz, seq integer,
    lat numeric, lon numeric, speed smallint
) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
    previous rastro.telemetry_events%ROWTYPE;
    head rastro.telemetry_events%ROWTYPE;
    is_late boolean;
BEGIN
    -- Serialise only this vehicle. Each SQL call participates in the caller's transaction.
    PERFORM 1 FROM rastro.vehicles WHERE vehicle_id = asset FOR UPDATE;
    IF NOT FOUND THEN
        RETURN 'unknown_vehicle';
    END IF;
    SELECT * INTO previous FROM rastro.telemetry_events
        WHERE vehicle_id = asset AND event_id = event_key;
    IF FOUND THEN
        IF (previous.observed_at, previous.device_seq, previous.latitude, previous.longitude, previous.speed_kmh)
             IS DISTINCT FROM (observed, seq, lat, lon, speed) THEN
            RETURN 'conflict';
        END IF;
        RETURN 'replay';
    END IF;
    IF EXISTS (SELECT 1 FROM rastro.telemetry_events
               WHERE vehicle_id = asset AND observed_at = observed AND device_seq = seq) THEN
        RETURN 'conflict';
    END IF;
    SELECT e.* INTO head FROM rastro.vehicle_state AS s
        JOIN rastro.telemetry_events AS e
          ON (e.vehicle_id, e.event_id) = (s.vehicle_id, s.current_event)
        WHERE s.vehicle_id = asset;
    is_late := FOUND AND (observed, seq) < (head.observed_at, head.device_seq);
    INSERT INTO rastro.telemetry_events
        (vehicle_id, event_id, observed_at, device_seq, latitude, longitude, speed_kmh, arrived_late)
        VALUES (asset, event_key, observed, seq, lat, lon, speed, is_late);
    INSERT INTO rastro.vehicle_state AS s (vehicle_id, current_event, unique_count, late_count)
        VALUES (asset, event_key, 1, is_late::integer)
        ON CONFLICT (vehicle_id) DO UPDATE SET
            current_event = CASE WHEN is_late THEN s.current_event ELSE excluded.current_event END,
            unique_count = s.unique_count + 1,
            late_count = s.late_count + excluded.late_count;
    RETURN CASE WHEN is_late THEN 'late' ELSE 'advanced' END;
END;
$$;
