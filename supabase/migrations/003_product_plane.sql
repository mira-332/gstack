-- gstack product-plane schema
-- Incident-driven QA data model for Cases, Scenarios, Scripts, Runs, and Knowledge.
-- This migration intentionally does not modify telemetry tables.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;

DO $$
BEGIN
  CREATE TYPE case_source_type AS ENUM ('incident', 'bug_report', 'support', 'qa_find', 'postmortem');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE case_status AS ENUM ('new', 'triaged', 'scenarioized', 'mitigated', 'closed');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE scenario_status AS ENUM ('draft', 'reviewed', 'approved', 'retired');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE script_status AS ENUM ('draft_only', 'active', 'retired');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE script_provenance AS ENUM ('human', 'codex', 'mixed');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE script_approval_state AS ENUM ('draft', 'reviewed', 'approved', 'sealed', 'revoked');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE run_trigger_type AS ENUM ('manual', 'scheduled', 'regression', 'incident', 'replay', 'pr');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE run_status AS ENUM ('queued', 'running', 'passed', 'failed', 'errored', 'canceled');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE artifact_class AS ENUM ('standard', 'sensitive', 'restricted');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE artifact_redaction_state AS ENUM ('raw', 'redacted', 'encrypted');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE knowledge_type AS ENUM ('best_practice', 'anti_pattern', 'incident_pattern', 'triage_note');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE knowledge_entity_type AS ENUM ('case', 'scenario', 'script_version', 'run');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

CREATE TABLE IF NOT EXISTS cases (
  case_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type case_source_type NOT NULL,
  source_ref TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  severity TEXT NOT NULL,
  feature_area TEXT NOT NULL,
  environment JSONB NOT NULL DEFAULT '{}'::jsonb,
  repro_steps JSONB NOT NULL DEFAULT '[]'::jsonb,
  expected TEXT,
  actual TEXT,
  status case_status NOT NULL DEFAULT 'new',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_type, source_ref)
);

CREATE TABLE IF NOT EXISTS scenarios (
  scenario_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  feature_area TEXT NOT NULL,
  criticality TEXT NOT NULL,
  charter TEXT NOT NULL,
  preconditions JSONB NOT NULL DEFAULT '[]'::jsonb,
  success_criteria JSONB NOT NULL DEFAULT '[]'::jsonb,
  edge_cases JSONB NOT NULL DEFAULT '[]'::jsonb,
  assertions JSONB NOT NULL DEFAULT '[]'::jsonb,
  status scenario_status NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS case_scenarios (
  case_id UUID NOT NULL REFERENCES cases(case_id) ON DELETE CASCADE,
  scenario_id UUID NOT NULL REFERENCES scenarios(scenario_id) ON DELETE CASCADE,
  link_reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (case_id, scenario_id)
);

CREATE TABLE IF NOT EXISTS scripts (
  script_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_id UUID NOT NULL REFERENCES scenarios(scenario_id) ON DELETE RESTRICT,
  runner_type TEXT NOT NULL,
  owner TEXT NOT NULL,
  active_version_id UUID,
  status script_status NOT NULL DEFAULT 'draft_only',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS script_versions (
  script_version_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  script_id UUID NOT NULL REFERENCES scripts(script_id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  repo_path TEXT NOT NULL,
  language TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  script_body TEXT NOT NULL,
  provenance script_provenance NOT NULL DEFAULT 'mixed',
  approval_state script_approval_state NOT NULL DEFAULT 'draft',
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  sealed_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  review_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (version > 0),
  UNIQUE (script_id, version)
);

ALTER TABLE script_versions DROP CONSTRAINT IF EXISTS script_versions_approval_gate;
ALTER TABLE script_versions
  ADD CONSTRAINT script_versions_approval_gate CHECK (
    (
      approval_state IN ('draft', 'reviewed')
      AND approved_by IS NULL
      AND approved_at IS NULL
      AND sealed_at IS NULL
      AND revoked_at IS NULL
    ) OR (
      approval_state = 'approved'
      AND approved_by IS NOT NULL
      AND approved_at IS NOT NULL
      AND sealed_at IS NULL
      AND revoked_at IS NULL
    ) OR (
      approval_state = 'sealed'
      AND approved_by IS NOT NULL
      AND approved_at IS NOT NULL
      AND sealed_at IS NOT NULL
      AND revoked_at IS NULL
    ) OR (
      approval_state = 'revoked'
      AND revoked_at IS NOT NULL
    )
  );

ALTER TABLE scripts DROP CONSTRAINT IF EXISTS scripts_active_version_fk;
ALTER TABLE scripts
  ADD CONSTRAINT scripts_active_version_fk
  FOREIGN KEY (active_version_id)
  REFERENCES script_versions(script_version_id)
  ON DELETE SET NULL;

ALTER TABLE scripts DROP CONSTRAINT IF EXISTS scripts_active_requires_version;
ALTER TABLE scripts
  ADD CONSTRAINT scripts_active_requires_version CHECK (
    status = 'draft_only' OR active_version_id IS NOT NULL
  );

CREATE TABLE IF NOT EXISTS runs (
  run_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  script_version_id UUID NOT NULL REFERENCES script_versions(script_version_id) ON DELETE RESTRICT,
  trigger_type run_trigger_type NOT NULL DEFAULT 'manual',
  environment JSONB NOT NULL DEFAULT '{}'::jsonb,
  commit_sha TEXT,
  result TEXT,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  failure_summary TEXT,
  status run_status NOT NULL DEFAULT 'queued',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (finished_at IS NULL OR started_at IS NOT NULL),
  CHECK (finished_at IS NULL OR finished_at >= started_at)
);

CREATE TABLE IF NOT EXISTS run_artifacts (
  run_artifact_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
  artifact_class artifact_class NOT NULL DEFAULT 'standard',
  storage_uri TEXT NOT NULL,
  redaction_state artifact_redaction_state NOT NULL DEFAULT 'raw',
  retention_policy TEXT NOT NULL DEFAULT 'standard',
  content_type TEXT,
  sha256 TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS knowledge (
  knowledge_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type knowledge_type NOT NULL,
  summary TEXT NOT NULL,
  best_practice TEXT NOT NULL,
  embedding vector(1536),
  confidence NUMERIC(4, 3) NOT NULL DEFAULT 0.5,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (confidence >= 0 AND confidence <= 1)
);

CREATE TABLE IF NOT EXISTS knowledge_links (
  knowledge_id UUID NOT NULL REFERENCES knowledge(knowledge_id) ON DELETE CASCADE,
  entity_type knowledge_entity_type NOT NULL,
  entity_id UUID NOT NULL,
  link_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (knowledge_id, entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_cases_status ON cases (status);
CREATE INDEX IF NOT EXISTS idx_cases_feature_area ON cases (feature_area);
CREATE INDEX IF NOT EXISTS idx_scenarios_status ON scenarios (status);
CREATE INDEX IF NOT EXISTS idx_scenarios_feature_area ON scenarios (feature_area);
CREATE INDEX IF NOT EXISTS idx_case_scenarios_scenario_id ON case_scenarios (scenario_id);
CREATE INDEX IF NOT EXISTS idx_scripts_scenario_id ON scripts (scenario_id);
CREATE INDEX IF NOT EXISTS idx_scripts_status ON scripts (status);
CREATE INDEX IF NOT EXISTS idx_script_versions_script_id_version ON script_versions (script_id, version DESC);
CREATE INDEX IF NOT EXISTS idx_script_versions_approval_state ON script_versions (approval_state);
CREATE INDEX IF NOT EXISTS idx_runs_script_version_id_started_at ON runs (script_version_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_status ON runs (status);
CREATE INDEX IF NOT EXISTS idx_run_artifacts_run_id ON run_artifacts (run_id);
CREATE INDEX IF NOT EXISTS idx_run_artifacts_class ON run_artifacts (artifact_class);
CREATE INDEX IF NOT EXISTS idx_knowledge_type ON knowledge (type);
CREATE INDEX IF NOT EXISTS idx_knowledge_confidence ON knowledge (confidence DESC);
CREATE INDEX IF NOT EXISTS idx_knowledge_links_entity ON knowledge_links (entity_type, entity_id);

ALTER TABLE cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE scenarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE case_scenarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE scripts ENABLE ROW LEVEL SECURITY;
ALTER TABLE script_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE run_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_links ENABLE ROW LEVEL SECURITY;
