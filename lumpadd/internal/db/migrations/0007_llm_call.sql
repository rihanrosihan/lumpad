-- Phase 4: the model gateway writes one coach.llm_call row per provider call (table planned in 0003). Added: HTTP status, effort, whether the
-- low-effort truncation retry was used, and a note (for example "answer rejected"). cost is in CNY (currency = 'CNY'); NULL = unknown (provider
-- without a price table). The monthly cap is computed from this table.
ALTER TABLE coach.llm_call
  ADD COLUMN IF NOT EXISTS status INTEGER,
  ADD COLUMN IF NOT EXISTS effort TEXT,
  ADD COLUMN IF NOT EXISTS retried_low BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS note TEXT;
CREATE INDEX IF NOT EXISTS llm_call_provider_at ON coach.llm_call (provider, at);
