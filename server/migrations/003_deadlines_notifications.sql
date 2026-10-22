-- Milestone 3: deadlines, escalation alerts, notifications, email deliveries, worker health.

-- One clock on one subject. A new generation starts whenever the due date changes (extension, resume),
-- so alerts computed for an older generation can be recognised as stale and never sent.
CREATE TABLE deadlines (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id      uuid NOT NULL REFERENCES applications(id),
  workflow_id         uuid REFERENCES workflow_instances(id),
  -- STAGE_HANDLING (subject = stage instance, re-pointed to the next attempt) or INSTITUTION_RESPONSE (subject = stage instance)
  clock_type          text NOT NULL CHECK (clock_type IN ('STAGE_HANDLING','INSTITUTION_RESPONSE')),
  subject_id          uuid NOT NULL,
  stage_key           text,
  label               text NOT NULL,
  anchor_at           timestamptz NOT NULL,
  rule                jsonb NOT NULL,
  calendar            jsonb NOT NULL,
  original_due_date   date NOT NULL,
  original_due_at     timestamptz NOT NULL,
  current_due_date    date NOT NULL,
  current_due_at      timestamptz NOT NULL,
  explanation         jsonb NOT NULL,
  -- ACTIVE, PAUSED, MET (closed in time or late), CANCELLED
  state               text NOT NULL CHECK (state IN ('ACTIVE','PAUSED','MET','CANCELLED')),
  generation          int NOT NULL DEFAULT 1,
  generation_started_at timestamptz NOT NULL,
  pause_on_return     boolean NOT NULL DEFAULT false,
  ladder              jsonb NOT NULL,
  -- when the scheduler next needs to look at this deadline (first ladder step not yet processed)
  next_step_at        timestamptz,
  policy_version_id   uuid NOT NULL REFERENCES policy_versions(id),
  rule_ref            text NOT NULL,
  provenance          text NOT NULL,
  created_at          timestamptz NOT NULL,
  closed_at           timestamptz,
  close_reason        text,
  met_late            boolean
);
CREATE INDEX deadlines_next_step ON deadlines (next_step_at) WHERE state = 'ACTIVE';
CREATE INDEX ON deadlines (application_id);
CREATE INDEX ON deadlines (subject_id);

CREATE TABLE deadline_pause_segments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deadline_id   uuid NOT NULL REFERENCES deadlines(id),
  paused_at     timestamptz NOT NULL,
  resumed_at    timestamptz,
  reason        text NOT NULL,
  days_lost     int
);

CREATE TABLE deadline_adjustments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deadline_id      uuid NOT NULL REFERENCES deadlines(id),
  kind             text NOT NULL CHECK (kind IN ('EXTENSION','RESUMED_AFTER_PAUSE')),
  from_due_date    date NOT NULL,
  to_due_date      date NOT NULL,
  from_generation  int NOT NULL,
  to_generation    int NOT NULL,
  reason           text NOT NULL,
  by_user_id       uuid REFERENCES users(id),
  at               timestamptz NOT NULL
);

-- One row per (deadline, generation, ladder step, recipient, channel): the database makes duplicate
-- alerts impossible even if two schedulers run. Steps passed while the scheduler was down are MISSED.
CREATE TABLE alert_events (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deadline_id        uuid NOT NULL REFERENCES deadlines(id),
  generation         int NOT NULL,
  step_id            text NOT NULL,
  step_kind          text NOT NULL CHECK (step_kind IN ('REMINDER','OVERDUE','ESCALATION')),
  recipient_user_id  uuid REFERENCES users(id),
  recipient_rule     text NOT NULL,
  channel            text NOT NULL CHECK (channel IN ('IN_APP','EMAIL','NONE')),
  -- CREATED (sent to the channel), MISSED (threshold passed while not running), UNRESOLVED (no recipient found)
  state              text NOT NULL CHECK (state IN ('CREATED','MISSED','UNRESOLVED')),
  step_at            timestamptz NOT NULL,
  created_at         timestamptz NOT NULL,
  UNIQUE NULLS NOT DISTINCT (deadline_id, generation, step_id, recipient_user_id, channel)
);
CREATE INDEX ON alert_events (deadline_id);

CREATE TABLE notifications (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES users(id),
  kind             text NOT NULL,
  severity         text NOT NULL DEFAULT 'INFO' CHECK (severity IN ('INFO','REMINDER','OVERDUE','ESCALATION')),
  title            text NOT NULL,
  body             text NOT NULL,
  application_id   uuid REFERENCES applications(id),
  alert_event_id   uuid REFERENCES alert_events(id),
  source_event_id  bigint,
  created_at       timestamptz NOT NULL,
  read_at          timestamptz,
  acknowledged_at  timestamptz,
  UNIQUE (user_id, source_event_id)
);
CREATE INDEX ON notifications (user_id, created_at DESC);

-- Email delivery intent written with the alert; a worker sends it after commit with a lease and retries.
CREATE TABLE deliveries (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id  uuid NOT NULL REFERENCES notifications(id),
  alert_event_id   uuid REFERENCES alert_events(id),
  to_address       text NOT NULL,
  subject          text NOT NULL,
  body             text NOT NULL,
  message_id       text NOT NULL UNIQUE,
  -- PENDING → SENDING → ACCEPTED | RETRYING → … | BOUNCED | DEAD | CANCELLED (stale before sending)
  state            text NOT NULL CHECK (state IN ('PENDING','SENDING','ACCEPTED','RETRYING','BOUNCED','DEAD','CANCELLED')),
  attempts         int NOT NULL DEFAULT 0,
  max_attempts     int NOT NULL DEFAULT 5,
  next_attempt_at  timestamptz NOT NULL,
  lease_until      timestamptz,
  locked_by        text,
  provider_ref     text,
  duplicate_suppressed boolean NOT NULL DEFAULT false,
  last_error       text,
  created_at       timestamptz NOT NULL,
  updated_at       timestamptz NOT NULL
);
CREATE INDEX deliveries_due ON deliveries (next_attempt_at) WHERE state IN ('PENDING','RETRYING','SENDING');

CREATE TABLE delivery_attempts (
  id            bigserial PRIMARY KEY,
  delivery_id   uuid NOT NULL REFERENCES deliveries(id),
  attempt_no    int NOT NULL,
  at            timestamptz NOT NULL,
  outcome       text NOT NULL,
  detail        text,
  worker_id     text
);

CREATE TABLE worker_heartbeats (
  worker_id     text PRIMARY KEY,
  started_at    timestamptz NOT NULL,
  last_seen_at  timestamptz NOT NULL,
  last_tick     jsonb NOT NULL DEFAULT '{}'
);
