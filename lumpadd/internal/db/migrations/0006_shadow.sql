-- Phase 3: shadow run results (gate G3: 14 consecutive days with every comparison identical).
CREATE TABLE analytics.shadow_check (
  id BIGSERIAL PRIMARY KEY,
  run_id BIGINT NOT NULL,
  ran_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  kind TEXT NOT NULL,          -- mirror | pull | fit | twin | corr
  ref TEXT NOT NULL,           -- trace id, label id, intel job id, …
  status TEXT NOT NULL,        -- ok | diff | stale | error
  n_diffs INT NOT NULL DEFAULT 0,
  diffs JSONB
);
CREATE INDEX shadow_check_day ON analytics.shadow_check (ran_at);
CREATE TABLE analytics.shadow_state (k TEXT PRIMARY KEY, v TEXT NOT NULL);
