-- B6b: reviewed corrections are separate, append-only records; source receipts/run counts stay frozen.
CREATE TABLE integration_resolution_attempts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), reconciliation_id uuid NOT NULL REFERENCES integration_reconciliation(id),
 action text NOT NULL CHECK(action IN ('RETRY','CORRECT_AND_RETRY','DISMISS')),
 outcome text NOT NULL CHECK(outcome IN ('APPLIED','STILL_BLOCKED','DISMISSED')),
 expected_version int NOT NULL CHECK(expected_version>0), cursor_version int NOT NULL CHECK(cursor_version>=0),
 reason text NOT NULL CHECK(length(trim(reason))>=10), evaluated_record jsonb NOT NULL, corrections jsonb NOT NULL DEFAULT '{}',
 canonical_event_id uuid REFERENCES integration_source_events(id), mapping_version_id text NOT NULL REFERENCES integration_mapping_versions(id),
 reason_code text, validation_details jsonb NOT NULL DEFAULT '[]', mirror_before jsonb, mirror_after jsonb,
 recorded_by uuid NOT NULL REFERENCES users(id), recorded_at timestamptz NOT NULL,
 UNIQUE(reconciliation_id,expected_version), CHECK(outcome<>'STILL_BLOCKED' OR reason_code IS NOT NULL)
);
CREATE TRIGGER immutable_integration_attempts BEFORE UPDATE OR DELETE ON integration_resolution_attempts FOR EACH ROW EXECUTE FUNCTION integration_history_immutable();
ALTER TABLE integration_reconciliation ADD COLUMN last_attempt_id uuid REFERENCES integration_resolution_attempts(id) DEFERRABLE INITIALLY DEFERRED;
-- A mirror written in the same transaction may reference the attempt whose final snapshots are inserted after it.
ALTER TABLE integration_mirrors ADD COLUMN latest_resolution_id uuid REFERENCES integration_resolution_attempts(id) DEFERRABLE INITIALLY DEFERRED;
