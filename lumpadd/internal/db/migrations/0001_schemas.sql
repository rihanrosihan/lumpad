CREATE SCHEMA IF NOT EXISTS raw;       -- unmodified provider data; every derived table can be rebuilt from it
CREATE SCHEMA IF NOT EXISTS train;     -- sessions, laps, per-session metrics, per-second streams
CREATE SCHEMA IF NOT EXISTS health;    -- daily wearable data, check-ins, symptoms, biometrics
CREATE SCHEMA IF NOT EXISTS athlete;   -- profile versions, rolling baselines, state snapshots (the twin)
CREATE SCHEMA IF NOT EXISTS plan;      -- season plan, approved overlays, adherence
CREATE SCHEMA IF NOT EXISTS coach;     -- decisions, LLM call ledger, jobs, runs
CREATE SCHEMA IF NOT EXISTS memory;    -- memory items, embeddings, knowledge docs, audit
CREATE SCHEMA IF NOT EXISTS analytics; -- correlation edges, matrices, daily features
CREATE SCHEMA IF NOT EXISTS app;       -- key/value state that used to live in kv.json
