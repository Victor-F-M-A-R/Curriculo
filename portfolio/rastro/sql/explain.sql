-- Run with psql -X -v ON_ERROR_STOP=1 -f sql/explain.sql in a dedicated database.
-- All measurements are from this execution. The sample exists only within this transaction.
BEGIN;
CREATE TEMPORARY TABLE rastro_plan_sample
    (LIKE rastro.telemetry_events INCLUDING DEFAULTS) ON COMMIT DROP;
INSERT INTO rastro_plan_sample
    (vehicle_id, event_id, observed_at, device_seq, latitude, longitude, speed_kmh, arrived_late)
SELECT 'T-' || asset, md5(asset::text || '/' || seq::text)::uuid,
       timestamptz '2026-01-01 00:00:00+00' + seq * interval '15 seconds',
       seq, -23.550000, -46.630000, 35, false
FROM generate_series(1, 100) AS fleet(asset)
CROSS JOIN generate_series(1, 600) AS track(seq);
ANALYZE rastro_plan_sample;

SELECT 'Antes do índice · 60.000 eventos' AS etapa;
EXPLAIN (ANALYZE, BUFFERS, TIMING OFF)
SELECT event_id, observed_at, device_seq, latitude, longitude, speed_kmh, arrived_late
FROM rastro_plan_sample WHERE vehicle_id = 'T-42'
ORDER BY observed_at DESC, device_seq DESC LIMIT 20;

CREATE UNIQUE INDEX rastro_sample_order
    ON rastro_plan_sample (vehicle_id, observed_at DESC, device_seq DESC)
    INCLUDE (event_id, latitude, longitude, speed_kmh, arrived_late);
ANALYZE rastro_plan_sample;
SELECT 'Depois do índice · mesma consulta e mesmos eventos' AS etapa;
EXPLAIN (ANALYZE, BUFFERS, TIMING OFF)
SELECT event_id, observed_at, device_seq, latitude, longitude, speed_kmh, arrived_late
FROM rastro_plan_sample WHERE vehicle_id = 'T-42'
ORDER BY observed_at DESC, device_seq DESC LIMIT 20;
ROLLBACK;
