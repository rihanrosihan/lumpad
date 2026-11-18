-- Tables that do not exist in the current system (redesign section 23). Empty until their phase fills them.
CREATE TABLE app.kv (key TEXT PRIMARY KEY, value JSONB NOT NULL, updated_at TEXT);

-- Phase 2: per-second FIT streams (a hypertable when TimescaleDB is installed, see 0004)
CREATE TABLE train.fit_stream (
  label_id TEXT NOT NULL, t TIMESTAMPTZ NOT NULL, dist_m REAL, speed_ms REAL, hr SMALLINT, cadence SMALLINT, power SMALLINT,
  gct_ms SMALLINT, stride_m REAL, vo_mm REAL, alt_m REAL, lat DOUBLE PRECISION, lon DOUBLE PRECISION
);
CREATE INDEX fit_stream_label ON train.fit_stream (label_id, t);

-- Phase 2/4: every metric with provenance. kind ∈ measured | device_estimate | calculated | model | reported
CREATE TABLE athlete.metric_value (
  id BIGSERIAL PRIMARY KEY, subject TEXT NOT NULL, name TEXT NOT NULL, value DOUBLE PRECISION, unit TEXT, measured_on DATE NOT NULL,
  source TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('measured','device_estimate','calculated','model','reported')),
  confidence REAL, n INTEGER, window_days INTEGER, engine_version TEXT, valid BOOLEAN NOT NULL DEFAULT true
);
CREATE INDEX metric_value_lookup ON athlete.metric_value (subject, name, measured_on DESC);
CREATE TABLE athlete.profile_version (
  id BIGSERIAL PRIMARY KEY, field TEXT NOT NULL, value TEXT NOT NULL, valid_from DATE NOT NULL, valid_to DATE, source TEXT NOT NULL
);

-- Phase 5: plan, approved overlays, adherence, decisions
CREATE TABLE plan.day (date DATE PRIMARY KEY, week TEXT, phase TEXT, kind TEXT, label TEXT, km DOUBLE PRECISION, steps JSONB, tags TEXT[], source TEXT);
CREATE TABLE plan.overlay (
  id BIGSERIAL PRIMARY KEY, date DATE NOT NULL, from_session JSONB NOT NULL, to_session JSONB NOT NULL, decision_id BIGINT, status TEXT NOT NULL DEFAULT 'proposed',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), decided_at TIMESTAMPTZ
);
CREATE TABLE plan.adherence (
  date DATE NOT NULL, activity_id TEXT, planned_km DOUBLE PRECISION, actual_km DOUBLE PRECISION, planned_s DOUBLE PRECISION, actual_s DOUBLE PRECISION,
  time_in_zone_pct DOUBLE PRECISION, pace_vs_target_pct DOUBLE PRECISION, score DOUBLE PRECISION, PRIMARY KEY (date, activity_id)
);
CREATE TABLE coach.decision (
  id BIGSERIAL PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), source TEXT NOT NULL, scope_from DATE, scope_to DATE, change JSONB NOT NULL,
  reason TEXT NOT NULL, evidence_ids BIGINT[] NOT NULL DEFAULT '{}', expected JSONB, status TEXT NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed','accepted','rejected','executed','skipped','evaluated')), outcome JSONB, verdict TEXT CHECK (verdict IN ('helped','neutral','harmed','unknown'))
);

-- Phase 4: LLM call ledger and the job queue (replaces coach_job)
CREATE TABLE coach.llm_call (
  id BIGSERIAL PRIMARY KEY, at TIMESTAMPTZ NOT NULL DEFAULT now(), intent TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL,
  tokens_in INTEGER, tokens_cached INTEGER, tokens_out INTEGER, tokens_reasoning INTEGER, latency_ms INTEGER, cost NUMERIC(12,6), currency TEXT,
  ok BOOLEAN NOT NULL, error TEXT, run_id BIGINT
);
CREATE INDEX llm_call_at ON coach.llm_call (at DESC);
CREATE TABLE coach.job (
  id BIGSERIAL PRIMARY KEY, kind TEXT NOT NULL, idem_key TEXT NOT NULL UNIQUE, payload JSONB, status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','running','done','failed','gave_up')), attempts INTEGER NOT NULL DEFAULT 0, next_run TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX job_due ON coach.job (status, next_run);

-- Memory: full-text search column + indexes on the mirrored memory.item (hash dedupe stays unique)
ALTER TABLE memory.item ADD COLUMN tsv tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(body,''))) STORED;
CREATE INDEX item_tsv ON memory.item USING GIN (tsv);
CREATE INDEX item_tier ON memory.item (tier, status);
CREATE UNIQUE INDEX item_hash ON memory.item (hash) WHERE hash IS NOT NULL;
CREATE UNIQUE INDEX item_ref ON memory.item (source, source_ref) WHERE source_ref IS NOT NULL;
CREATE INDEX activity_date ON train.activity (date);
CREATE INDEX session_metric_date ON train.session_metric (date);
