-- M4: synthetic EVC directory, readiness, reservations and immutable report revisions.
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE TABLE expert_profiles (
  user_id uuid PRIMARY KEY REFERENCES users(id),
  specialisms text[] NOT NULL DEFAULT '{}',
  home_region_id text REFERENCES regions(id),
  own_institution_id uuid REFERENCES institutions(id),
  affiliated_region_ids text[] NOT NULL DEFAULT '{}',
  directory_complete boolean NOT NULL DEFAULT false,
  eligible boolean NOT NULL DEFAULT true,
  max_visits_per_month int NOT NULL CHECK (max_visits_per_month BETWEEN 1 AND 100),
  provenance text NOT NULL DEFAULT 'DEMO_ASSUMPTION' CHECK (provenance IN ('APH_CLAUSE','ADMIN_INSTRUCTION','DEMO_ASSUMPTION'))
);
CREATE TABLE expert_availability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expert_user_id uuid NOT NULL REFERENCES expert_profiles(user_id),
  available tstzrange NOT NULL CHECK (NOT isempty(available) AND NOT lower_inf(available) AND NOT upper_inf(available))
);
CREATE TABLE declared_conflicts (
  expert_user_id uuid NOT NULL REFERENCES expert_profiles(user_id),
  institution_id uuid NOT NULL REFERENCES institutions(id),
  reason text NOT NULL,
  PRIMARY KEY (expert_user_id, institution_id)
);
CREATE TABLE evc_readiness (
  stage_instance_id uuid PRIMARY KEY REFERENCES stage_instances(id),
  application_id uuid NOT NULL REFERENCES applications(id),
  ready_at timestamptz NOT NULL
);
CREATE TABLE evc_visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES applications(id),
  stage_instance_id uuid NOT NULL REFERENCES evc_readiness(stage_instance_id),
  ready_at timestamptz NOT NULL,
  mode text NOT NULL CHECK (mode IN ('PHYSICAL','ONLINE','HYBRID')),
  timezone text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL CHECK (ends_at > starts_at),
  scheduled tstzrange GENERATED ALWAYS AS (tstzrange(starts_at, ends_at, '[)')) STORED,
  state text NOT NULL CHECK (state IN ('PROPOSED','CONFIRMED','HELD','REPORT_SUBMITTED','REPORT_ACCEPTED','CANCELLED','RESCHEDULED')),
  specialism text NOT NULL,
  rescheduled_from_id uuid REFERENCES evc_visits(id),
  institution_acknowledged_at timestamptz,
  institution_acknowledged_by uuid REFERENCES users(id),
  held_at timestamptz,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL,
  row_version int NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX evc_one_live_visit ON evc_visits(stage_instance_id) WHERE state NOT IN ('CANCELLED','RESCHEDULED');
CREATE INDEX ON evc_visits(application_id);
CREATE TABLE visit_members (
  visit_id uuid NOT NULL REFERENCES evc_visits(id),
  expert_user_id uuid NOT NULL REFERENCES expert_profiles(user_id),
  committee_id text NOT NULL REFERENCES committees(id),
  confirmed_at timestamptz,
  PRIMARY KEY (visit_id, expert_user_id)
);
CREATE TABLE expert_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id uuid NOT NULL REFERENCES evc_visits(id),
  expert_user_id uuid NOT NULL REFERENCES expert_profiles(user_id),
  reserved tstzrange NOT NULL CHECK (NOT isempty(reserved) AND NOT lower_inf(reserved) AND NOT upper_inf(reserved)),
  active boolean NOT NULL DEFAULT true,
  EXCLUDE USING gist (expert_user_id WITH =, reserved WITH &&) WHERE (active),
  UNIQUE (visit_id, expert_user_id)
);
CREATE TABLE visit_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id uuid NOT NULL REFERENCES evc_visits(id),
  revision int NOT NULL,
  summary text NOT NULL,
  submitted_by uuid NOT NULL REFERENCES users(id),
  submitted_at timestamptz NOT NULL,
  UNIQUE(visit_id, revision)
);
CREATE TABLE visit_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES visit_reports(id),
  requirement text NOT NULL,
  observation text NOT NULL,
  visibility text NOT NULL CHECK (visibility IN ('INTERNAL','INSTITUTION'))
);
CREATE TABLE visit_events (
  id bigserial PRIMARY KEY,
  visit_id uuid NOT NULL REFERENCES evc_visits(id),
  action text NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES users(id),
  reason text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}',
  at timestamptz NOT NULL
);
-- Report submissions and their observations are append-only; return/accept decisions are events.
CREATE FUNCTION evc_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'EVC history is append-only' USING ERRCODE = '23514'; END $$;
CREATE TRIGGER reports_immutable BEFORE UPDATE OR DELETE ON visit_reports FOR EACH ROW EXECUTE FUNCTION evc_immutable();
CREATE TRIGGER visit_findings_immutable BEFORE UPDATE OR DELETE ON visit_findings FOR EACH ROW EXECUTE FUNCTION evc_immutable();
CREATE TRIGGER visit_events_immutable BEFORE UPDATE OR DELETE ON visit_events FOR EACH ROW EXECUTE FUNCTION evc_immutable();
ALTER TABLE deadlines DROP CONSTRAINT deadlines_clock_type_check;
ALTER TABLE deadlines ADD CONSTRAINT deadlines_clock_type_check CHECK (clock_type IN ('STAGE_HANDLING','INSTITUTION_RESPONSE','EVC_SCHEDULING','EVC_REPORT'));
-- Backfill readiness for existing live EVC stages; never invent readiness before prerequisites completed.
INSERT INTO evc_readiness(stage_instance_id, application_id, ready_at)
SELECT s.id, s.application_id, s.entered_at FROM stage_instances s JOIN workflow_instances w ON w.current_stage_id = s.id
WHERE s.stage_kind = 'EVC' AND s.state IN ('QUEUED','ASSIGNED','IN_PROGRESS')
AND NOT EXISTS (SELECT 1 FROM stage_instances p WHERE p.workflow_id = s.workflow_id AND p.route_position < s.route_position
  AND NOT EXISTS (SELECT 1 FROM stage_instances done WHERE done.workflow_id = p.workflow_id AND done.route_position = p.route_position AND done.state = 'COMPLETED'));
