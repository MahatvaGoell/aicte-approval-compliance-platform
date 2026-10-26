-- M5: private immutable versions, human reviews and traceable condition obligations.
ALTER TABLE applications ADD CONSTRAINT application_institution_pair UNIQUE(id, institution_id);
CREATE TABLE document_records (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), application_id uuid NOT NULL, institution_id uuid NOT NULL,
 document_type text NOT NULL, title text NOT NULL, visibility text NOT NULL CHECK (visibility IN ('INTERNAL','INSTITUTION')),
 current_verified_version_id uuid, latest_version_id uuid, row_version int NOT NULL DEFAULT 1,
 created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL,
 FOREIGN KEY(application_id,institution_id) REFERENCES applications(id,institution_id), UNIQUE(id,application_id)
);
CREATE TABLE document_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), document_id uuid NOT NULL REFERENCES document_records(id), application_id uuid NOT NULL,
 version_no int NOT NULL, predecessor_id uuid, storage_key text NOT NULL UNIQUE CHECK(storage_key ~ '^[0-9a-f]{32}$'),
 sha256 text NOT NULL CHECK(sha256 ~ '^[0-9a-f]{64}$'), media_type text NOT NULL, size_bytes int NOT NULL CHECK(size_bytes > 0),
 filename text NOT NULL, page_estimate int, declared_metadata jsonb NOT NULL DEFAULT '{}',
 uploaded_by uuid NOT NULL REFERENCES users(id), received_at timestamptz NOT NULL,
 UNIQUE(document_id,version_no), UNIQUE(id,document_id), UNIQUE(id,application_id), FOREIGN KEY(document_id,application_id) REFERENCES document_records(id,application_id),
 FOREIGN KEY(predecessor_id,document_id) REFERENCES document_versions(id,document_id)
);
ALTER TABLE document_records ADD FOREIGN KEY(current_verified_version_id,id) REFERENCES document_versions(id,document_id);
ALTER TABLE document_records ADD FOREIGN KEY(latest_version_id,id) REFERENCES document_versions(id,document_id);
CREATE TABLE metadata_reviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), sequence_no bigserial UNIQUE, version_id uuid NOT NULL REFERENCES document_versions(id),
 confirmed_values jsonb NOT NULL, reviewed_by uuid NOT NULL REFERENCES users(id), reviewed_at timestamptz NOT NULL, reason text NOT NULL,
 UNIQUE(id,version_id)
);
CREATE TABLE document_verifications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), version_id uuid NOT NULL UNIQUE REFERENCES document_versions(id),
 metadata_review_id uuid, outcome text NOT NULL CHECK(outcome IN ('ACCEPT','REJECT')),
 reason text NOT NULL, verified_by uuid NOT NULL REFERENCES users(id), verified_at timestamptz NOT NULL,
 FOREIGN KEY(metadata_review_id,version_id) REFERENCES metadata_reviews(id,version_id)
);
CREATE TABLE obligations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), application_id uuid NOT NULL REFERENCES applications(id),
 decision_id uuid NOT NULL REFERENCES decisions(id), condition_index int NOT NULL CHECK(condition_index >= 0),
 condition_text text NOT NULL, required_document_type text NOT NULL, policy_version_id uuid NOT NULL REFERENCES policy_versions(id),
 verifier_user_id uuid NOT NULL REFERENCES users(id), state text NOT NULL DEFAULT 'OPEN'
 CHECK(state IN ('OPEN','EVIDENCE_SUBMITTED','UNDER_VERIFICATION','FULFILLED','CLOSED_WITH_AUTHORISED_REASON')),
 current_submission_id uuid, row_version int NOT NULL DEFAULT 1, created_at timestamptz NOT NULL,
 closed_at timestamptz, closed_reason text, UNIQUE(decision_id,condition_index), UNIQUE(id,application_id)
);
CREATE TABLE evidence_submissions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), receipt_no bigserial UNIQUE, obligation_id uuid NOT NULL REFERENCES obligations(id),
 application_id uuid NOT NULL REFERENCES applications(id), submitted_by uuid NOT NULL REFERENCES users(id),
 received_at timestamptz NOT NULL, effective_due_at timestamptz NOT NULL, on_time boolean NOT NULL,
 deadline_generation int NOT NULL, reason text NOT NULL, UNIQUE(id,obligation_id), UNIQUE(id,application_id),
 FOREIGN KEY(obligation_id,application_id) REFERENCES obligations(id,application_id)
);
ALTER TABLE obligations ADD FOREIGN KEY(current_submission_id,id) REFERENCES evidence_submissions(id,obligation_id);
CREATE TABLE submission_documents (
 submission_id uuid NOT NULL REFERENCES evidence_submissions(id), version_id uuid NOT NULL REFERENCES document_versions(id), application_id uuid NOT NULL,
 PRIMARY KEY(submission_id,version_id), FOREIGN KEY(submission_id,application_id) REFERENCES evidence_submissions(id,application_id), FOREIGN KEY(version_id,application_id) REFERENCES document_versions(id,application_id)
);
CREATE TABLE verification_results (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), submission_id uuid NOT NULL UNIQUE REFERENCES evidence_submissions(id),
 outcome text NOT NULL CHECK(outcome IN ('ACCEPT','REJECT')), reason text NOT NULL,
 verified_by uuid NOT NULL REFERENCES users(id), verified_at timestamptz NOT NULL
);
CREATE TABLE document_attachments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), application_id uuid NOT NULL REFERENCES applications(id),
 version_id uuid NOT NULL REFERENCES document_versions(id), target_kind text NOT NULL CHECK(target_kind IN ('FINDING_RESPONSE','VISIT_REPORT','VISIT_FINDING')),
 target_id uuid NOT NULL, attached_by uuid NOT NULL REFERENCES users(id), attached_at timestamptz NOT NULL,
 UNIQUE(version_id,target_kind,target_id), FOREIGN KEY(version_id,application_id) REFERENCES document_versions(id,application_id)
);
CREATE TABLE upload_leases (
 storage_key text PRIMARY KEY, expires_at timestamptz NOT NULL
);
CREATE INDEX ON document_records(application_id);
CREATE INDEX ON obligations(application_id,state);
CREATE INDEX ON evidence_submissions(obligation_id);
CREATE FUNCTION immutable_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Evidence history is immutable' USING ERRCODE = '23514'; END $$;
ALTER TABLE finding_responses ADD COLUMN receipt_sequence bigserial;
CREATE TRIGGER immutable_finding_responses BEFORE UPDATE OR DELETE ON finding_responses FOR EACH ROW EXECUTE FUNCTION immutable_evidence();
CREATE TRIGGER immutable_document_versions BEFORE UPDATE OR DELETE ON document_versions FOR EACH ROW EXECUTE FUNCTION immutable_evidence();
CREATE TRIGGER immutable_metadata_reviews BEFORE UPDATE OR DELETE ON metadata_reviews FOR EACH ROW EXECUTE FUNCTION immutable_evidence();
CREATE TRIGGER immutable_document_verifications BEFORE UPDATE OR DELETE ON document_verifications FOR EACH ROW EXECUTE FUNCTION immutable_evidence();
CREATE TRIGGER immutable_evidence_receipts BEFORE UPDATE OR DELETE ON evidence_submissions FOR EACH ROW EXECUTE FUNCTION immutable_evidence();
CREATE TRIGGER immutable_submission_documents BEFORE UPDATE OR DELETE ON submission_documents FOR EACH ROW EXECUTE FUNCTION immutable_evidence();
CREATE TRIGGER immutable_verification_results BEFORE UPDATE OR DELETE ON verification_results FOR EACH ROW EXECUTE FUNCTION immutable_evidence();
CREATE TRIGGER immutable_document_attachments BEFORE UPDATE OR DELETE ON document_attachments FOR EACH ROW EXECUTE FUNCTION immutable_evidence();
ALTER TABLE deadlines DROP CONSTRAINT deadlines_clock_type_check;
ALTER TABLE deadlines ADD COLUMN visibility text NOT NULL DEFAULT 'INSTITUTION' CHECK(visibility IN ('INTERNAL','INSTITUTION'));
ALTER TABLE deadlines ADD CONSTRAINT deadlines_clock_type_check CHECK(clock_type IN ('STAGE_HANDLING','INSTITUTION_RESPONSE','EVC_SCHEDULING','EVC_REPORT','OBLIGATION_SUBMISSION','VERIFICATION','DOCUMENT_VALIDITY'));
