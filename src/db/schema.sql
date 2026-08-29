-- QualityOracle event indexer schema (issue #17).
-- Applied by src/db/client.ts's runMigrations() on indexer startup; every
-- statement is idempotent (IF NOT EXISTS) so re-running it is always safe.

CREATE TABLE IF NOT EXISTS quality_attestations (
  id SERIAL PRIMARY KEY,
  dataset_id TEXT NOT NULL,
  curator TEXT NOT NULL,
  score INT NOT NULL CHECK (score BETWEEN 0 AND 100),
  rubric_ipfs TEXT,
  ledger INT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (dataset_id, curator) -- one score per curator per dataset
);

CREATE TABLE IF NOT EXISTS curators (
  address TEXT PRIMARY KEY,
  registered_ledger INT NOT NULL,
  slashed BOOLEAN NOT NULL DEFAULT FALSE,
  slashed_ledger INT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Aggregate view for GET /datasets/:id/quality (src/routes/v1/quality.ts) to
-- read from directly, instead of averaging quality_attestations per request.
CREATE TABLE IF NOT EXISTS dataset_quality (
  dataset_id TEXT PRIMARY KEY,
  average_score NUMERIC(5, 2) NOT NULL DEFAULT 0,
  attestation_count INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tracks the last ledger this indexer fully processed, so a restart resumes
-- instead of re-scanning from the RPC server's event-retention horizon.
CREATE TABLE IF NOT EXISTS indexer_cursors (
  indexer_name TEXT PRIMARY KEY,
  last_ledger INT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
