-- Finale B. Exact synthetic claims; flags only. Every rule is a DEMO_ASSUMPTION.
CREATE TABLE resources (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),kind text NOT NULL CHECK(kind IN ('FACULTY','LAB','BUILDING')),
 identity_key text NOT NULL,display_name text NOT NULL,is_synthetic boolean NOT NULL DEFAULT true CHECK(is_synthetic),UNIQUE(kind,identity_key)
);
CREATE TABLE resource_claims (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),resource_id uuid NOT NULL REFERENCES resources(id),
 application_id uuid NOT NULL REFERENCES applications(id),institution_id uuid NOT NULL REFERENCES institutions(id),
 programme_code text,usage text NOT NULL,declared_name text NOT NULL,period_from date NOT NULL,period_to date,
 source text NOT NULL CHECK(source IN ('APPLICATION_FORM','SEED')),created_at timestamptz NOT NULL,
 CHECK(period_to IS NULL OR period_to>=period_from)
);
CREATE INDEX ON resource_claims(application_id);
CREATE INDEX ON resource_claims(resource_id,period_from);
CREATE TABLE claim_flags (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),resource_id uuid NOT NULL REFERENCES resources(id),claim_ids uuid[] NOT NULL CHECK(cardinality(claim_ids)=2),
 kind text NOT NULL DEFAULT 'OVERLAPPING_CLAIM' CHECK(kind='OVERLAPPING_CLAIM'),
 state text NOT NULL DEFAULT 'OPEN' CHECK(state IN ('OPEN','EXPLAINED','CONFIRMED')),
 detected_at timestamptz NOT NULL,rule_ref text NOT NULL,provenance text NOT NULL CHECK(provenance='DEMO_ASSUMPTION'),
 reviewed_by uuid REFERENCES users(id),reviewed_at timestamptz,review_note text,
 review_application_id uuid REFERENCES applications(id),note_visible_to_institution boolean NOT NULL DEFAULT false,row_version integer NOT NULL DEFAULT 1,
 UNIQUE(resource_id,claim_ids)
);
CREATE INDEX ON claim_flags USING gin(claim_ids);
