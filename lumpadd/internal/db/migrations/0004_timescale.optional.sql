-- optional: extension timescaledb
-- Per-second streams and daily series become hypertables. Skipped (and recorded as skipped) when TimescaleDB is not installed;
-- the fallback is native range partitioning (0006) if the 2 GB RAM gate fails with TimescaleDB.
CREATE EXTENSION IF NOT EXISTS timescaledb;
SELECT create_hypertable('train.fit_stream', 't', chunk_time_interval => INTERVAL '30 days', if_not_exists => true);
ALTER TABLE train.fit_stream SET (timescaledb.compress, timescaledb.compress_segmentby = 'label_id', timescaledb.compress_orderby = 't');
SELECT add_compression_policy('train.fit_stream', INTERVAL '60 days', if_not_exists => true);
