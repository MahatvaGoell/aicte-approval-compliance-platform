-- B6a: disconnected synthetic source imports. These tables never update local case state.
CREATE TABLE integration_mapping_versions (
 id text PRIMARY KEY, source_system text NOT NULL CHECK(source_system='MOCK_PORTAL'),
 contract_version int NOT NULL, document jsonb NOT NULL, provenance text NOT NULL CHECK(provenance='DEMO_ASSUMPTION'),
 published_at timestamptz NOT NULL, UNIQUE(id,source_system)
);
INSERT INTO integration_mapping_versions VALUES ('mock-portal-v1','MOCK_PORTAL',1,
 '{"statusCodes":{"RECEIVED":"SOURCE_RECEIVED","PROCESSING":"SOURCE_PROCESSING","COMPLETE":"SOURCE_REPORTED_COMPLETE"}}',
 'DEMO_ASSUMPTION','2026-01-01T00:00:00Z');

CREATE TABLE integration_cursors (
 source_system text NOT NULL CHECK(source_system='MOCK_PORTAL'), region_id text NOT NULL REFERENCES regions(id),
 row_version int NOT NULL DEFAULT 0 CHECK(row_version>=0), updated_at timestamptz NOT NULL,
 PRIMARY KEY(source_system,region_id)
);
CREATE TABLE integration_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_system text NOT NULL, region_id text NOT NULL REFERENCES regions(id),
 mapping_version_id text NOT NULL, input_kind text NOT NULL CHECK(input_kind IN ('FIXTURE','INLINE')),
 started_by uuid NOT NULL REFERENCES users(id), started_at timestamptz NOT NULL, completed_at timestamptz,
 state text NOT NULL DEFAULT 'RUNNING' CHECK(state IN ('RUNNING','COMPLETED')),
 total_count int NOT NULL DEFAULT 0, accepted_count int NOT NULL DEFAULT 0, duplicate_count int NOT NULL DEFAULT 0,
 invalid_count int NOT NULL DEFAULT 0, reconciliation_count int NOT NULL DEFAULT 0,
 FOREIGN KEY(mapping_version_id,source_system) REFERENCES integration_mapping_versions(id,source_system),
 CHECK(total_count=accepted_count+duplicate_count+invalid_count+reconciliation_count),
 CHECK(accepted_count>=0 AND duplicate_count>=0 AND invalid_count>=0 AND reconciliation_count>=0),
 CHECK((state='RUNNING' AND completed_at IS NULL) OR (state='COMPLETED' AND completed_at IS NOT NULL))
);
CREATE INDEX ON integration_runs(region_id,started_at,id);
CREATE TABLE integration_raw_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), run_id uuid NOT NULL REFERENCES integration_runs(id), ordinal int NOT NULL CHECK(ordinal>0),
 payload jsonb NOT NULL, payload_sha256 text NOT NULL CHECK(payload_sha256 ~ '^[0-9a-f]{64}$'),
 institution_id uuid REFERENCES institutions(id), received_at timestamptz NOT NULL, UNIQUE(run_id,ordinal)
);
CREATE INDEX ON integration_raw_events(payload_sha256);
CREATE TABLE integration_source_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_system text NOT NULL CHECK(source_system='MOCK_PORTAL'),
 region_id text NOT NULL REFERENCES regions(id), external_id text NOT NULL, event_id text NOT NULL,
 revision int NOT NULL CHECK(revision>0), raw_event_id uuid NOT NULL UNIQUE REFERENCES integration_raw_events(id),
 UNIQUE(source_system,external_id,event_id), UNIQUE(source_system,external_id,revision)
);
ALTER TABLE institutions ADD CONSTRAINT institution_region_pair UNIQUE(id,region_id);
CREATE TABLE integration_mirrors (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_system text NOT NULL CHECK(source_system='MOCK_PORTAL'), external_id text NOT NULL,
 region_id text NOT NULL REFERENCES regions(id), institution_id uuid NOT NULL,
 source_title text NOT NULL, source_status text NOT NULL CHECK(source_status IN ('SOURCE_RECEIVED','SOURCE_PROCESSING','SOURCE_REPORTED_COMPLETE')),
 source_updated_at timestamptz NOT NULL, latest_revision int NOT NULL CHECK(latest_revision>0),
 latest_event_id uuid NOT NULL REFERENCES integration_source_events(id), mapping_version_id text NOT NULL REFERENCES integration_mapping_versions(id),
 row_version int NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL,
 UNIQUE(source_system,external_id), FOREIGN KEY(institution_id,region_id) REFERENCES institutions(id,region_id)
);
CREATE TABLE integration_run_items (
 raw_event_id uuid PRIMARY KEY REFERENCES integration_raw_events(id),
 canonical_event_id uuid REFERENCES integration_source_events(id),
 outcome text NOT NULL CHECK(outcome IN ('ACCEPTED','DUPLICATE','INVALID','RECONCILIATION')),
 reason_code text, details jsonb NOT NULL DEFAULT '[]',
 CHECK(outcome IN ('ACCEPTED','DUPLICATE') OR reason_code IS NOT NULL)
);
CREATE TABLE integration_reconciliation (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), raw_event_id uuid NOT NULL UNIQUE REFERENCES integration_raw_events(id),
 reason_code text NOT NULL, state text NOT NULL DEFAULT 'OPEN' CHECK(state IN ('OPEN','RESOLVED','DISMISSED')),
 row_version int NOT NULL DEFAULT 1, created_at timestamptz NOT NULL,
 resolved_at timestamptz, resolved_by uuid REFERENCES users(id), resolution_reason text
);
CREATE INDEX ON integration_reconciliation(state,created_at);
CREATE FUNCTION integration_history_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Integration source history is append-only' USING ERRCODE='23514'; END $$;
CREATE TRIGGER immutable_integration_mapping BEFORE UPDATE OR DELETE ON integration_mapping_versions FOR EACH ROW EXECUTE FUNCTION integration_history_immutable();
CREATE TRIGGER immutable_integration_raw BEFORE UPDATE OR DELETE ON integration_raw_events FOR EACH ROW EXECUTE FUNCTION integration_history_immutable();
CREATE TRIGGER immutable_integration_source BEFORE UPDATE OR DELETE ON integration_source_events FOR EACH ROW EXECUTE FUNCTION integration_history_immutable();
CREATE TRIGGER immutable_integration_items BEFORE UPDATE OR DELETE ON integration_run_items FOR EACH ROW EXECUTE FUNCTION integration_history_immutable();
CREATE FUNCTION integration_run_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.state='COMPLETED' OR TG_OP='DELETE' THEN RAISE EXCEPTION 'Completed integration runs are immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER immutable_completed_integration_run BEFORE UPDATE OR DELETE ON integration_runs FOR EACH ROW EXECUTE FUNCTION integration_run_frozen();
