-- Finale A: DEMO_ASSUMPTION custody accounting and re-scrutiny justification.
CREATE TABLE custody_segments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), application_id uuid NOT NULL REFERENCES applications(id),
 holder text NOT NULL CHECK(holder IN ('OFFICE','INSTITUTION','AUTHORITY')), stage_key text,
 started_at timestamptz NOT NULL, ended_at timestamptz, opened_by_transition text NOT NULL, reason text NOT NULL,
 CHECK(ended_at IS NULL OR ended_at>=started_at)
);
CREATE UNIQUE INDEX custody_one_open ON custody_segments(application_id) WHERE ended_at IS NULL;
CREATE INDEX ON custody_segments(application_id,started_at);
ALTER TABLE applications ADD COLUMN custody_history_incomplete boolean NOT NULL DEFAULT false;
UPDATE applications SET custody_history_incomplete=true WHERE submitted_at IS NOT NULL;
ALTER TABLE findings ADD COLUMN raised_in_attempt integer;
ALTER TABLE findings ADD COLUMN new_objection_justification text;
ALTER TABLE findings ADD COLUMN earlier_finding_id uuid REFERENCES findings(id);
UPDATE findings f SET raised_in_attempt=s.attempt_no FROM stage_instances s WHERE s.id=f.stage_instance_id;
