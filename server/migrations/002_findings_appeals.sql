-- Milestone 2: findings and deficiency returns, linked amendments, appeals.

-- A deficiency or clarification raised during a stage attempt. Findings stay attached to the attempt
-- that raised them, so a re-scrutiny never overwrites what the earlier attempt recorded.
CREATE TABLE findings (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id      uuid NOT NULL REFERENCES applications(id),
  workflow_id         uuid NOT NULL REFERENCES workflow_instances(id),
  stage_instance_id   uuid NOT NULL REFERENCES stage_instances(id),
  stage_key           text NOT NULL,
  checklist_code      text,
  reason_code         text NOT NULL CHECK (reason_code IN ('MISSING_DOCUMENT','INCOMPLETE_INFORMATION','NON_COMPLIANCE','CLARIFICATION','OTHER')),
  explanation         text NOT NULL,
  requested_evidence  text,
  -- who must act: the institution (returned to it) or the office (internal follow-up)
  responsible_party   text NOT NULL CHECK (responsible_party IN ('INSTITUTION','OFFICE')),
  visibility          text NOT NULL CHECK (visibility IN ('INTERNAL','INSTITUTION')),
  requests_amendment  boolean NOT NULL DEFAULT false,
  -- OPEN (raised, not yet sent) → RESPONSE_PENDING (returned) → RESPONSE_SUBMITTED → RESOLVED | NOT_RESOLVED
  state               text NOT NULL CHECK (state IN ('OPEN','RESPONSE_PENDING','RESPONSE_SUBMITTED','RESOLVED','NOT_RESOLVED')),
  raised_by           uuid NOT NULL REFERENCES users(id),
  raised_at           timestamptz NOT NULL,
  returned_at         timestamptz,
  response_due_note   text,
  closed_by           uuid REFERENCES users(id),
  closed_at           timestamptz,
  closure_note        text,
  CHECK (visibility = 'INSTITUTION' OR responsible_party = 'OFFICE')
);
CREATE INDEX ON findings (application_id);
CREATE INDEX ON findings (workflow_id, state);

CREATE TABLE finding_responses (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  finding_id       uuid NOT NULL REFERENCES findings(id),
  application_id   uuid NOT NULL REFERENCES applications(id),
  text             text NOT NULL,
  submitted_by     uuid NOT NULL REFERENCES users(id),
  submitted_at     timestamptz NOT NULL
);
CREATE INDEX ON finding_responses (finding_id);

-- Changes the institution makes in reply to a finding. The submitted snapshot is never edited;
-- an amendment is a separate, linked record.
CREATE TABLE amendments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id   uuid NOT NULL REFERENCES applications(id),
  finding_id       uuid NOT NULL REFERENCES findings(id),
  changes          jsonb NOT NULL,
  note             text NOT NULL,
  submitted_by     uuid NOT NULL REFERENCES users(id),
  submitted_at     timestamptz NOT NULL
);
CREATE INDEX ON amendments (application_id);

-- An appeal against a recorded decision. The appealed decision is never modified; the appeal runs as
-- a separate workflow instance of kind APPEAL on the same application.
CREATE TABLE appeals (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id   uuid NOT NULL REFERENCES applications(id),
  decision_id      uuid NOT NULL UNIQUE REFERENCES decisions(id),
  workflow_id      uuid NOT NULL UNIQUE REFERENCES workflow_instances(id),
  grounds          text NOT NULL,
  filed_by         uuid NOT NULL REFERENCES users(id),
  filed_at         timestamptz NOT NULL
);

ALTER TABLE workflow_instances ADD CONSTRAINT workflow_appeal_decision_fk
  FOREIGN KEY (appeal_of_decision_id) REFERENCES decisions(id);
