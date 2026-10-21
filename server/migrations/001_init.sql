-- M1 schema: identity and scopes, reference data, versioned policy, applications and workflow, audit, outbox.
-- Later milestones add their tables in further migrations.
-- These are software states for the prototype, not official AICTE status codes.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------- reference data
CREATE TABLE regions (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  is_synthetic boolean NOT NULL DEFAULT true
);

CREATE TABLE institutions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aicte_permanent_id  text UNIQUE,
  name                text NOT NULL,
  address             text NOT NULL,
  district            text NOT NULL,
  state               text NOT NULL,
  region_id           text NOT NULL REFERENCES regions(id),
  institution_type    text NOT NULL,
  is_synthetic        boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE institution_contacts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id  uuid NOT NULL REFERENCES institutions(id),
  name            text NOT NULL,
  designation     text NOT NULL,
  email           text NOT NULL,
  phone           text,
  is_authorised   boolean NOT NULL DEFAULT true
);

CREATE TABLE cycles (
  code       text PRIMARY KEY,
  starts_on  date NOT NULL,
  ends_on    date NOT NULL
);

-- ---------------------------------------------------------------- identity and scoped grants
CREATE TABLE users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email          text NOT NULL UNIQUE,
  name           text NOT NULL,
  password_hash  text NOT NULL,
  is_active      boolean NOT NULL DEFAULT true,
  failed_logins  int NOT NULL DEFAULT 0,
  locked_until   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE committees (
  id         text PRIMARY KEY,
  name       text NOT NULL,
  kind       text NOT NULL CHECK (kind IN ('SCRUTINY','EVC','SAC','SHC')),
  region_id  text REFERENCES regions(id)
);

-- A role held within a scope for a period. Capabilities come from the role (see permissions.ts)
-- plus any extra capabilities named on the grant (for example EVC_SCHEDULE).
CREATE TABLE capability_grants (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid NOT NULL REFERENCES users(id),
  role                 text NOT NULL CHECK (role IN ('INSTITUTION_REP','REGIONAL_OFFICER','BUREAU_OFFICER',
                         'COMMITTEE_MEMBER','COMPETENT_AUTHORITY','SYSTEM_ADMIN','POLICY_ADMIN',
                         'POLICY_APPROVER','AUDITOR')),
  official_designation text,
  institution_id       uuid REFERENCES institutions(id),
  -- NULL region_ids with scope_all = true means every region.
  region_ids           text[] NOT NULL DEFAULT '{}',
  scope_all            boolean NOT NULL DEFAULT false,
  committee_id         text REFERENCES committees(id),
  extra_capabilities   text[] NOT NULL DEFAULT '{}',
  delegation_source    text,
  valid_from           timestamptz NOT NULL DEFAULT now(),
  valid_to             timestamptz,
  granted_by           uuid REFERENCES users(id),
  granted_at           timestamptz NOT NULL DEFAULT now(),
  revoked_at           timestamptz,
  revoked_by           uuid REFERENCES users(id),
  revoke_reason        text,
  CHECK (role <> 'INSTITUTION_REP' OR institution_id IS NOT NULL),
  CHECK (role <> 'COMMITTEE_MEMBER' OR committee_id IS NOT NULL)
);
CREATE INDEX ON capability_grants (user_id);

CREATE TABLE sessions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash       text NOT NULL UNIQUE,
  user_id          uuid NOT NULL REFERENCES users(id),
  active_grant_id  uuid NOT NULL REFERENCES capability_grants(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  last_seen_at     timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL,
  revoked_at       timestamptz,
  ip               text,
  user_agent       text
);

-- ---------------------------------------------------------------- policy
-- Where a rule came from. Only APH_CLAUSE entries may be presented as handbook requirements.
CREATE TABLE policy_sources (
  id               text PRIMARY KEY,
  provenance       text NOT NULL CHECK (provenance IN ('APH_CLAUSE','ADMIN_INSTRUCTION','DEMO_ASSUMPTION')),
  issuer           text NOT NULL,
  title            text NOT NULL,
  academic_year    text,
  published_on     date,
  effective_from   date,
  retrieved_on     date,
  file_sha256      text,
  clause_locator   text,
  url              text,
  reviewed_by      text,
  review_status    text NOT NULL DEFAULT 'UNREVIEWED' CHECK (review_status IN ('UNREVIEWED','REVIEWED')),
  notes            text
);

CREATE TABLE policy_versions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_key      text NOT NULL DEFAULT 'approval-process',
  version_no      int NOT NULL,
  label           text NOT NULL,
  status          text NOT NULL CHECK (status IN ('DRAFT','PUBLISHED','RETIRED')),
  document        jsonb NOT NULL,
  checksum        text NOT NULL,
  effective_from  timestamptz,
  created_by      uuid REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  published_by    uuid REFERENCES users(id),
  published_at    timestamptz,
  change_note     text,
  based_on_id     uuid REFERENCES policy_versions(id),
  row_version     int NOT NULL DEFAULT 1,
  UNIQUE (policy_key, version_no)
);

-- ---------------------------------------------------------------- applications and workflow
CREATE SEQUENCE application_no_seq START 1001;

CREATE TABLE applications (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_no               text NOT NULL UNIQUE,
  institution_id       uuid NOT NULL REFERENCES institutions(id),
  -- copied from the institution at creation so scoping does not depend on later profile edits
  region_id            text NOT NULL REFERENCES regions(id),
  cycle_code           text NOT NULL REFERENCES cycles(code),
  -- DRAFT, SUBMITTED, AWAITING_CLASSIFICATION, IN_PROCESS, AWAITING_DECISION, DECISION_RECORDED, CLOSED, WITHDRAWN
  lifecycle_state      text NOT NULL,
  form_schema_version  text NOT NULL DEFAULT 'demo-form-v1',
  draft_data           jsonb NOT NULL DEFAULT '{}',
  submitted_snapshot   jsonb,
  snapshot_sha256      text,
  submitted_at         timestamptz,
  submitted_by         uuid REFERENCES users(id),
  -- decision outcome and compliance are separate dimensions from the lifecycle
  decision_outcome     text CHECK (decision_outcome IN ('APPROVED','APPROVED_WITH_CONDITIONS','REJECTED','DEFERRED')),
  compliance_status    text NOT NULL DEFAULT 'NONE' CHECK (compliance_status IN ('NONE','OPEN','OVERDUE','ALL_FULFILLED')),
  current_workflow_id  uuid,
  created_by           uuid NOT NULL REFERENCES users(id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  row_version          int NOT NULL DEFAULT 1,
  is_synthetic         boolean NOT NULL DEFAULT true
);
CREATE INDEX ON applications (institution_id);
CREATE INDEX ON applications (region_id, lifecycle_state);

-- The approval sought. One per application in the demo; the table allows several later.
CREATE TABLE proposals (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id         uuid NOT NULL REFERENCES applications(id),
  category_code          text NOT NULL,
  details                jsonb NOT NULL DEFAULT '{}',
  -- PENDING (draft), CLASSIFIED, NEEDS_CLASSIFICATION
  classification_status  text NOT NULL DEFAULT 'PENDING',
  created_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON proposals (application_id);

CREATE TABLE workflow_instances (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id        uuid NOT NULL REFERENCES applications(id),
  proposal_id           uuid NOT NULL REFERENCES proposals(id),
  kind                  text NOT NULL DEFAULT 'PRIMARY' CHECK (kind IN ('PRIMARY','APPEAL')),
  appeal_of_decision_id uuid,
  policy_version_id     uuid NOT NULL REFERENCES policy_versions(id),
  route_key             text,
  classification_trace  jsonb NOT NULL,
  -- ACTIVE, AWAITING_CLASSIFICATION, COMPLETED, CANCELLED
  state                 text NOT NULL,
  current_stage_id      uuid,
  created_at            timestamptz NOT NULL,
  completed_at          timestamptz
);
CREATE INDEX ON workflow_instances (application_id);

ALTER TABLE applications ADD CONSTRAINT applications_current_workflow_fk
  FOREIGN KEY (current_workflow_id) REFERENCES workflow_instances(id) DEFERRABLE INITIALLY DEFERRED;

-- One attempt at one configured stage. A return closes the attempt and opens a new one,
-- so earlier review records are never overwritten.
CREATE TABLE stage_instances (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id        uuid NOT NULL REFERENCES workflow_instances(id),
  application_id     uuid NOT NULL REFERENCES applications(id),
  stage_key          text NOT NULL,
  stage_kind         text NOT NULL CHECK (stage_kind IN ('SCRUTINY','EVC','COMMITTEE','DECISION')),
  route_position     int NOT NULL,
  attempt_no         int NOT NULL DEFAULT 1,
  -- QUEUED, ASSIGNED, IN_PROGRESS, AWAITING_RESPONSE, COMPLETED, CANCELLED
  state              text NOT NULL,
  owner_role         text NOT NULL,
  committee_id       text REFERENCES committees(id),
  assignee_user_id   uuid REFERENCES users(id),
  rule_ref           text NOT NULL,
  entered_at         timestamptz NOT NULL,
  started_at         timestamptz,
  completed_at       timestamptz,
  outcome            text,
  outcome_reason     text,
  completed_by       uuid REFERENCES users(id),
  UNIQUE (workflow_id, stage_key, attempt_no)
);
CREATE INDEX ON stage_instances (application_id);
CREATE INDEX ON stage_instances (assignee_user_id) WHERE state IN ('ASSIGNED','IN_PROGRESS');
-- Only one live stage per workflow: blocks conflicting parallel transitions at the database level.
CREATE UNIQUE INDEX one_live_stage_per_workflow ON stage_instances (workflow_id)
  WHERE state IN ('QUEUED','ASSIGNED','IN_PROGRESS','AWAITING_RESPONSE');

ALTER TABLE workflow_instances ADD CONSTRAINT workflow_current_stage_fk
  FOREIGN KEY (current_stage_id) REFERENCES stage_instances(id) DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE stage_assignments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_instance_id uuid NOT NULL REFERENCES stage_instances(id),
  user_id           uuid NOT NULL REFERENCES users(id),
  assigned_by       uuid REFERENCES users(id),
  method            text NOT NULL CHECK (method IN ('AUTO_LEAST_LOADED','MANUAL')),
  reason            text NOT NULL,
  assigned_at       timestamptz NOT NULL,
  ended_at          timestamptz
);
CREATE INDEX ON stage_assignments (user_id);

CREATE TABLE transitions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id     uuid NOT NULL REFERENCES applications(id),
  workflow_id        uuid REFERENCES workflow_instances(id),
  command            text NOT NULL,
  from_stage         text,
  to_stage           text,
  from_state         text,
  to_state           text,
  actor_user_id      uuid REFERENCES users(id),
  actor_role         text NOT NULL,
  reason             text,
  policy_version_id  uuid REFERENCES policy_versions(id),
  rule_ref           text,
  at                 timestamptz NOT NULL
);
CREATE INDEX ON transitions (application_id, at);

CREATE TABLE checklist_items (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_instance_id  uuid NOT NULL REFERENCES stage_instances(id),
  code               text NOT NULL,
  requirement        text NOT NULL,
  rule_ref           text NOT NULL,
  provenance         text NOT NULL,
  evidence_doc_type  text,
  -- PENDING, SATISFIED, DEFICIENT, NOT_APPLICABLE
  status             text NOT NULL DEFAULT 'PENDING',
  observation        text,
  updated_by         uuid REFERENCES users(id),
  updated_at         timestamptz,
  UNIQUE (stage_instance_id, code)
);

CREATE TABLE recommendations (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id     uuid NOT NULL REFERENCES applications(id),
  stage_instance_id  uuid NOT NULL REFERENCES stage_instances(id),
  author_user_id     uuid NOT NULL REFERENCES users(id),
  author_role        text NOT NULL,
  committee_id       text REFERENCES committees(id),
  recommendation     text NOT NULL CHECK (recommendation IN ('RECOMMEND_APPROVAL','RECOMMEND_APPROVAL_WITH_CONDITIONS',
                       'RECOMMEND_REJECTION','RECOMMEND_DEFERRAL')),
  text               text NOT NULL,
  proposed_conditions jsonb NOT NULL DEFAULT '[]',
  created_at         timestamptz NOT NULL
);

-- An authoritative decision, recorded only by a competent authority. Separate from recommendations.
CREATE TABLE decisions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id     uuid NOT NULL REFERENCES applications(id),
  workflow_id        uuid NOT NULL REFERENCES workflow_instances(id),
  stage_instance_id  uuid NOT NULL REFERENCES stage_instances(id),
  outcome            text NOT NULL CHECK (outcome IN ('APPROVED','APPROVED_WITH_CONDITIONS','REJECTED','DEFERRED')),
  reason             text NOT NULL,
  conditions         jsonb NOT NULL DEFAULT '[]',
  authority_user_id  uuid NOT NULL REFERENCES users(id),
  authority_grant_id uuid NOT NULL REFERENCES capability_grants(id),
  policy_version_id  uuid NOT NULL REFERENCES policy_versions(id),
  rule_ref           text NOT NULL,
  issued_at          timestamptz NOT NULL,
  UNIQUE (workflow_id)
);

-- ---------------------------------------------------------------- outbox (written in the same transaction as the change)
CREATE TABLE outbox_events (
  id              bigserial PRIMARY KEY,
  event_type      text NOT NULL,
  aggregate_type  text NOT NULL,
  aggregate_id    text NOT NULL,
  payload         jsonb NOT NULL,
  correlation_id  text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  -- PENDING, PROCESSED, FAILED
  state           text NOT NULL DEFAULT 'PENDING',
  attempts        int NOT NULL DEFAULT 0,
  locked_until    timestamptz,
  processed_at    timestamptz,
  last_error      text
);
CREATE INDEX outbox_pending ON outbox_events (id) WHERE state = 'PENDING';

-- ---------------------------------------------------------------- settings, idempotency
CREATE TABLE system_settings (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  updated_by  uuid REFERENCES users(id),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE idempotency_keys (
  user_id        uuid NOT NULL REFERENCES users(id),
  key            text NOT NULL,
  operation      text NOT NULL,
  request_hash   text NOT NULL,
  status_code    int,
  response       jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);

-- ---------------------------------------------------------------- audit
CREATE TABLE audit_events (
  id                 bigserial PRIMARY KEY,
  at                 timestamptz NOT NULL,
  recorded_at        timestamptz NOT NULL DEFAULT now(),
  actor_user_id      uuid REFERENCES users(id),
  actor_role         text NOT NULL,
  actor_grant_id     uuid,
  institution_id     uuid,
  application_id     uuid,
  entity_type        text NOT NULL,
  entity_id          text NOT NULL,
  action             text NOT NULL,
  before_state       jsonb,
  after_state        jsonb,
  reason             text,
  policy_version_id  uuid,
  rule_ref           text,
  document_ids       uuid[] NOT NULL DEFAULT '{}',
  correlation_id     text NOT NULL,
  visibility         text NOT NULL DEFAULT 'INTERNAL' CHECK (visibility IN ('INTERNAL','INSTITUTION')),
  prev_hash          text NOT NULL,
  hash               text NOT NULL
);
CREATE INDEX ON audit_events (application_id, id);
CREATE INDEX ON audit_events (institution_id, id);
CREATE INDEX ON audit_events (entity_type, entity_id);

-- Ordinary application sessions cannot change or remove audit rows. A database superuser can still
-- bypass this, which is why the hash chain exists: it makes such changes detectable, not impossible.
CREATE FUNCTION audit_events_block_modification() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_events_no_update BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_block_modification();
CREATE TRIGGER audit_events_no_truncate BEFORE TRUNCATE ON audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION audit_events_block_modification();
